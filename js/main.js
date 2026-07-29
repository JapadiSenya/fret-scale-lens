// 初期化・イベントバインド

import { NOTE_NAMES, frequencyOf } from './notes.js';
import { SCALE_LIST, FUNCTION_LABELS } from './scales.js';
import {
  TUNING_PRESETS,
  findPreset,
  clampFretCount,
  addString,
  removeString,
  updateString,
  MIN_STRINGS,
  MAX_STRINGS,
} from './tuning.js';
import {
  loadSettings,
  saveSettings,
  loadTabLibrary,
  saveTabLibrary,
  peekLegacyTempoAndTimeSignature,
} from './storage.js';
import { playFrequency, setMasterVolume } from './audio.js';
import { renderFretboard } from './render.js';
import {
  DURATION_LIST,
  createTabData,
  createNoteEntry,
  createRestEntry,
  insertEntry,
  insertEntries,
  removeRange,
  setDurationRange,
  setDottedRange,
  canTie,
  canHammerPull,
  canSlide,
  canTuplet,
  canAddPitch,
  addPitchToEntry,
  canMergeChord,
  mergeToChord,
  toggleTieAt,
  toggleHammerPullAt,
  toggleSlideAt,
  toggleTupletAt,
  cloneRange,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  computeMeasures,
  beatsBeforeIndex,
  indexAtBeats,
  migrateTabData,
  migrateEntry,
  addTabToLibrary,
  removeTabFromLibrary,
  setActiveTabId,
  legacyTempoOf,
  legacyTimeSignatureOf,
} from './tab.js';
import { renderTab, setPlayingColumn, getColumnElement } from './tabRender.js';
import { playTab } from './tabPlayback.js';

const OCTAVE_OPTIONS = [0, 1, 2, 3, 4, 5, 6];
const CUSTOM_PRESET_VALUE = 'custom';

const state = loadSettings();

// --- マイグレーション: 旧形式(画面側にtuning/fretCount、TABごとにtempoEvents/timeSignature)を
//     新形式(TABごとにtuning/fretCount、画面側にtempo/timeSignature)へ畳み込む ---
const legacyTuningFallback = Array.isArray(state.tuning) ? state.tuning : undefined;
const legacyFretCountFallback = Number.isFinite(state.fretCount) ? state.fretCount : undefined;
delete state.tuning;
delete state.fretCount;

const legacyTempoTimeSignature = peekLegacyTempoAndTimeSignature();
if (legacyTempoTimeSignature.tempo != null) state.tempo = legacyTempoTimeSignature.tempo;
if (legacyTempoTimeSignature.timeSignature != null) state.timeSignature = legacyTempoTimeSignature.timeSignature;

let tabLibrary = loadTabLibrary({ tuning: legacyTuningFallback, fretCount: legacyFretCountFallback });

// マイグレーション結果を保存し直す(以後は新形式のみを読み書きする)
saveSettings(state);
saveTabLibrary(tabLibrary);

const songTitleInput = document.getElementById('song-title-input');
const keySelect = document.getElementById('key-select');
const scaleSelect = document.getElementById('scale-select');
const presetSelect = document.getElementById('preset-select');
const tuningDetailBtn = document.getElementById('tuning-detail-btn');
const tuningDialog = document.getElementById('tuning-dialog');
const fretCountInput = document.getElementById('fret-count-input');
const stringListEl = document.getElementById('string-list');
const addStringBtn = document.getElementById('add-string-btn');
const fretboardContainer = document.getElementById('fretboard-container');
const displayModeToggle = document.getElementById('display-mode-toggle');
const legendEl = document.getElementById('legend');
const masterVolumeInput = document.getElementById('master-volume');
const tempoInput = document.getElementById('tempo-input');
const timeSignatureInput = document.getElementById('time-signature-input');

const tabBarListEl = document.getElementById('tab-bar-list');
const tabAddBtn = document.getElementById('tab-add-btn');
const newTabDialog = document.getElementById('new-tab-dialog');
const newTabForm = document.getElementById('new-tab-form');
const newTabPartNameInput = document.getElementById('new-tab-partname-input');
const newTabPresetSelect = document.getElementById('new-tab-preset-select');
const newTabCancelBtn = document.getElementById('new-tab-cancel-btn');

const tabTitleInput = document.getElementById('tab-title-input');
const durationButtonsEl = document.getElementById('duration-buttons');
const tabRestBtn = document.getElementById('tab-rest-btn');
const tabDottedBtn = document.getElementById('tab-dotted-btn');
const tabGhostBtn = document.getElementById('tab-ghost-btn');
const tabChordBtn = document.getElementById('tab-chord-btn');
const tabTieBtn = document.getElementById('tab-tie-btn');
const tabHammerPullBtn = document.getElementById('tab-hammer-pull-btn');
const tabSlideBtn = document.getElementById('tab-slide-btn');
const tabTupletBtn = document.getElementById('tab-tuplet-btn');
const tabDeleteBtn = document.getElementById('tab-delete-btn');
const tabUndoBtn = document.getElementById('tab-undo-btn');
const tabRedoBtn = document.getElementById('tab-redo-btn');
const tabCopyBtn = document.getElementById('tab-copy-btn');
const tabPasteBtn = document.getElementById('tab-paste-btn');
const tabPlayBtn = document.getElementById('tab-play-btn');
const tabMetronomeBtn = document.getElementById('tab-metronome-btn');
const tabOctaveUpBtn = document.getElementById('tab-octave-up-btn');
const tabColorSyncBtn = document.getElementById('tab-color-sync-btn');
const tabExportBtn = document.getElementById('tab-export-btn');
const tabImportBtn = document.getElementById('tab-import-btn');
const tabImportInput = document.getElementById('tab-import-input');
const tabDisplay = document.getElementById('tab-display');
const tabJsonDetails = document.getElementById('tab-json-details');
const tabJsonTextarea = document.getElementById('tab-json-textarea');
const tabJsonError = document.getElementById('tab-json-error');
const toastContainer = document.getElementById('toast-container');
const simulPlayListEl = document.getElementById('simul-play-list');

let tabData = tabLibrary.tabs.find((t) => t.id === tabLibrary.activeTabId) ?? tabLibrary.tabs[0];
let tabHistory = createHistory(tabData);
let tabSelection = null; // {start, end} (notesへのインデックス範囲、順不同)。TABごとにtabSessionsへ退避する
const tabSessions = new Map(); // tabId -> {history, selection}(非アクティブなTABの状態)
const simultaneousTabIds = new Set(); // 同時再生対象の他TAB id(セッション内のみのUI状態、永続化しない)
let tabClipboard = null; // TABをまたいで共有するクリップボード
let selectedDuration = 'quarter';
let dottedInput = false;
let pendingInputMode = 'note'; // 'note' | 'ghost'
let chordInputMode = false; // 有効時、単一選択中のエントリへ指板クリックでピッチを追加する
// 再生セッション。同時再生では複数トラック(アクティブTAB + 同時再生に選択された他TAB)が
// 並行して鳴るため、1セッションとして全トラックのハンドルをまとめて保持し、
// 「全トラックが終わって初めて再生終了」とする。
// { tracks: [{ handle, finished, isActive }], pending }
// onNoteStart/onEndのコールバックは、発行時点のセッションオブジェクトが現在も有効な場合のみ処理する
// (停止操作とタイマー発火がほぼ同時に起きた場合などに、既に停止済み・別セッションに切り替わった
// 後の古いコールバックがplayingIndex等の状態を誤って書き換えるのを防ぐ)
let playbackSession = null;
let playingIndex = null;

function isTabPlaying() {
  return playbackSession !== null;
}

const DISPLAY_MODE_LABELS = {
  scale: 'スケール構成音',
  function: '機能和声(T/S/D)',
};

function populateStaticSelects() {
  keySelect.replaceChildren(...NOTE_NAMES.map((n) => new Option(n, n)));
  scaleSelect.replaceChildren(...SCALE_LIST.map((s) => new Option(s.label, s.id)));
  presetSelect.replaceChildren(
    ...TUNING_PRESETS.map((p) => new Option(p.label, p.id)),
    new Option('カスタム', CUSTOM_PRESET_VALUE)
  );
  newTabPresetSelect.replaceChildren(...TUNING_PRESETS.map((p) => new Option(p.label, p.id)));
}

function sameTuning(a, b) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.name === b[i].name && s.octave === b[i].octave);
}

function syncControlsFromState() {
  songTitleInput.value = state.songTitle;
  keySelect.value = state.key;
  scaleSelect.value = state.scale;
  tempoInput.value = state.tempo;
  timeSignatureInput.value = state.timeSignature;
  fretCountInput.value = tabData.fretCount;
  const matchedPreset = TUNING_PRESETS.find((p) => sameTuning(p.strings, tabData.tuning));
  presetSelect.value = matchedPreset ? matchedPreset.id : CUSTOM_PRESET_VALUE;
  syncDisplayModeToggle();
  masterVolumeInput.value = String(state.masterVolume);
  syncTabOctaveUpButton();
  syncTabColorSyncButton();
  syncTabMetronomeButton();
}

function syncTabMetronomeButton() {
  tabMetronomeBtn.classList.toggle('active', state.tabMetronome);
  tabMetronomeBtn.setAttribute('aria-pressed', String(state.tabMetronome));
}

function syncTabOctaveUpButton() {
  tabOctaveUpBtn.classList.toggle('active', state.tabOctaveUp);
  tabOctaveUpBtn.setAttribute('aria-pressed', String(state.tabOctaveUp));
}

function syncTabColorSyncButton() {
  tabColorSyncBtn.classList.toggle('active', state.tabColorSync);
  tabColorSyncBtn.setAttribute('aria-pressed', String(state.tabColorSync));
}

function syncDisplayModeToggle() {
  displayModeToggle.textContent = `表示: ${DISPLAY_MODE_LABELS[state.displayMode]}`;
  displayModeToggle.setAttribute('aria-pressed', String(state.displayMode === 'function'));
}

function persistAndRender() {
  saveSettings(state);
  render();
}

function persist() {
  saveSettings(state);
}

function render() {
  renderFretboard(fretboardContainer, { ...state, tuning: tabData.tuning, fretCount: tabData.fretCount }, {
    onNoteClick: (stringIndex, fret, note) => {
      playFrequency(frequencyOf(note.name, note.octave));
      handleFretboardNoteInput(stringIndex, fret);
    },
  });
  renderLegend();
  renderTabBar();
  renderSimulPlayList();
  renderTabView();
}

function renderLegend() {
  const items =
    state.displayMode === 'function'
      ? [
          { swatchClass: 'function-t', label: `${FUNCTION_LABELS.T} (T)` },
          { swatchClass: 'function-s', label: `${FUNCTION_LABELS.S} (S)` },
          { swatchClass: 'function-d', label: `${FUNCTION_LABELS.D} (D)` },
          { swatchClass: 'function-neutral', label: 'ブルーノートなど(機能なし)' },
          { swatchClass: 'root-accent', label: 'ルート(太枠で強調)' },
        ]
      : [
          { swatchClass: 'root', label: 'ルート' },
          { swatchClass: 'in-scale', label: 'スケール構成音' },
          { swatchClass: 'muted', label: 'スケール外' },
        ];

  legendEl.replaceChildren(
    ...items.map(({ swatchClass, label }) => {
      const item = document.createElement('span');
      item.className = 'legend-item';

      const swatch = document.createElement('span');
      swatch.className = `legend-swatch ${swatchClass}`;

      const text = document.createElement('span');
      text.textContent = label;

      item.append(swatch, text);
      return item;
    })
  );
}

function renderStringList() {
  stringListEl.replaceChildren();

  // 1弦(高音弦)がフレットボード上部・リスト先頭に来るよう、低音→高音順のtabData.tuningを逆順表示する
  const total = tabData.tuning.length;
  [...tabData.tuning].reverse().forEach((s, displayIndex) => {
    const index = total - 1 - displayIndex;
    const row = document.createElement('div');
    row.className = 'string-row';

    const label = document.createElement('span');
    label.className = 'string-row-label';
    label.textContent = `弦${displayIndex + 1}`;

    const nameSelect = document.createElement('select');
    nameSelect.replaceChildren(...NOTE_NAMES.map((n) => new Option(n, n)));
    nameSelect.value = s.name;
    nameSelect.addEventListener('change', () => {
      commitTab({ tuning: updateString(tabData.tuning, index, { name: nameSelect.value }) });
      presetSelect.value = CUSTOM_PRESET_VALUE;
      render();
    });

    const octaveSelect = document.createElement('select');
    octaveSelect.replaceChildren(...OCTAVE_OPTIONS.map((o) => new Option(String(o), String(o))));
    octaveSelect.value = String(s.octave);
    octaveSelect.addEventListener('change', () => {
      commitTab({ tuning: updateString(tabData.tuning, index, { octave: Number(octaveSelect.value) }) });
      presetSelect.value = CUSTOM_PRESET_VALUE;
      render();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '削除';
    removeBtn.disabled = tabData.tuning.length <= MIN_STRINGS;
    removeBtn.addEventListener('click', () => {
      commitTab({ tuning: removeString(tabData.tuning, index) });
      presetSelect.value = CUSTOM_PRESET_VALUE;
      render();
      renderStringList();
    });

    row.append(label, nameSelect, octaveSelect, removeBtn);
    stringListEl.appendChild(row);
  });

  addStringBtn.disabled = tabData.tuning.length >= MAX_STRINGS;
}

// --- マルチTAB管理 ---

function renderTabBar() {
  const isPlaying = isTabPlaying();
  tabBarListEl.replaceChildren(
    ...tabLibrary.tabs.map((t) => {
      const item = document.createElement('div');
      item.className = 'tab-bar-item';
      if (t.id === tabLibrary.activeTabId) item.classList.add('active');

      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'tab-bar-title';
      titleBtn.textContent = t.partName;
      titleBtn.disabled = isPlaying;
      titleBtn.setAttribute('role', 'tab');
      titleBtn.setAttribute('aria-selected', String(t.id === tabLibrary.activeTabId));
      titleBtn.addEventListener('click', () => switchToTab(t.id));

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-bar-close';
      closeBtn.textContent = '×';
      closeBtn.setAttribute('aria-label', `${t.partName}を削除`);
      closeBtn.disabled = isPlaying || tabLibrary.tabs.length <= 1;
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!window.confirm(`「${t.partName}」を削除しますか?`)) return;
        deleteTab(t.id);
      });

      item.append(titleBtn, closeBtn);
      return item;
    })
  );
  tabAddBtn.disabled = isPlaying;
}

function renderSimulPlayList() {
  const others = tabLibrary.tabs.filter((t) => t.id !== tabData.id);
  if (others.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'simul-play-empty';
    empty.textContent = '他にTABがありません';
    simulPlayListEl.replaceChildren(empty);
    return;
  }

  simulPlayListEl.replaceChildren(
    ...others.map((t) => {
      const label = document.createElement('label');
      label.className = 'simul-play-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = simultaneousTabIds.has(t.id);
      checkbox.disabled = isTabPlaying();
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) simultaneousTabIds.add(t.id);
        else simultaneousTabIds.delete(t.id);
        syncTabButtons();
      });

      const text = document.createElement('span');
      text.textContent = t.partName;

      label.append(checkbox, text);
      return label;
    })
  );
}

// アクティブTABを切り替える。切り替え元のUndo履歴・選択範囲はtabSessionsへ退避し、
// 切り替え先の状態(あれば)を復元する
function switchToTab(tabId) {
  if (isTabPlaying() || tabId === tabLibrary.activeTabId) return;

  tabSessions.set(tabData.id, { history: tabHistory, selection: tabSelection });

  tabLibrary = setActiveTabId(tabLibrary, tabId);
  saveTabLibrary(tabLibrary);
  tabData = tabLibrary.tabs.find((t) => t.id === tabId);

  const session = tabSessions.get(tabId);
  tabHistory = session ? session.history : createHistory(tabData);
  tabSelection = session ? session.selection : null;
  tabSessions.delete(tabId);

  simultaneousTabIds.delete(tabId); // 自分自身は同時再生の対象外にする

  syncControlsFromState();
  renderStringList();
  render();
}

function deleteTab(tabId) {
  if (isTabPlaying()) return;
  const wasActive = tabId === tabLibrary.activeTabId;

  tabLibrary = removeTabFromLibrary(tabLibrary, tabId);
  tabSessions.delete(tabId);
  simultaneousTabIds.delete(tabId);
  saveTabLibrary(tabLibrary);

  if (wasActive) {
    tabData = tabLibrary.tabs.find((t) => t.id === tabLibrary.activeTabId);
    const session = tabSessions.get(tabData.id);
    tabHistory = session ? session.history : createHistory(tabData);
    tabSelection = session ? session.selection : null;
    tabSessions.delete(tabData.id);
    syncControlsFromState();
    renderStringList();
  }
  render();
}

// --- TAB譜作成・再生機能 ---

function populateDurationButtons() {
  durationButtonsEl.replaceChildren(
    ...DURATION_LIST.map((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d.label;
      btn.dataset.duration = d.id;
      btn.addEventListener('click', () => {
        if (tabSelection) {
          commitTab({ notes: setDurationRange(tabData.notes, tabSelection.start, tabSelection.end, d.id) });
        }
        selectedDuration = d.id;
        renderTabView();
      });
      return btn;
    })
  );
}

function syncGhostButton() {
  const active = pendingInputMode === 'ghost';
  tabGhostBtn.classList.toggle('active', active);
  tabGhostBtn.setAttribute('aria-pressed', String(active));
}

function syncChordButton() {
  tabChordBtn.classList.toggle('active', chordInputMode);
  tabChordBtn.setAttribute('aria-pressed', String(chordInputMode));
}

function syncDottedButton() {
  tabDottedBtn.classList.toggle('active', dottedInput);
  tabDottedBtn.setAttribute('aria-pressed', String(dottedInput));
}

function syncTabLibrary() {
  tabLibrary = { ...tabLibrary, tabs: tabLibrary.tabs.map((t) => (t.id === tabData.id ? tabData : t)) };
  saveTabLibrary(tabLibrary);
}

// notes配列以外も含めた変更(title/tuning/fretCount等)をまとめて履歴に積んでコミットする
function commitTab(partialChanges) {
  const nextTabData = { ...tabData, ...partialChanges };
  tabHistory = pushHistory(tabHistory, nextTabData);
  tabData = tabHistory.present;
  syncTabLibrary();
}

function handleFretboardNoteInput(stringIndex, fret) {
  const singleSelected =
    tabSelection && tabSelection.start === tabSelection.end ? tabSelection.start : undefined;
  const isGhost = pendingInputMode === 'ghost';

  // 和音入力モード中、単一の音符を選択していれば新規挿入せずそのエントリにピッチを追加する。
  // ghostは弦(ピッチ)ごとの属性なので、既存の和音に通常のフレット音とミュート弦を混在させられる
  if (chordInputMode && singleSelected !== undefined && canAddPitch(tabData.notes[singleSelected])) {
    commitTab({
      notes: addPitchToEntry(tabData.notes, singleSelected, { string: stringIndex, fret, ghost: isGhost }),
    });
    if (isGhost) {
      pendingInputMode = 'note';
      syncGhostButton();
    }
    renderTabView();
    return;
  }

  const entry = createNoteEntry({
    string: stringIndex,
    fret,
    duration: selectedDuration,
    dotted: dottedInput,
    ghost: isGhost,
  });

  commitTab({ notes: insertEntry(tabData.notes, entry, singleSelected) });

  const insertedIndex = singleSelected !== undefined ? singleSelected + 1 : tabData.notes.length - 1;
  tabSelection = { start: insertedIndex, end: insertedIndex };
  if (isGhost) {
    pendingInputMode = 'note';
    syncGhostButton();
  }
  renderTabView();
}

function isIndexInSelection(index, selection) {
  const from = Math.min(selection.start, selection.end);
  const to = Math.max(selection.start, selection.end);
  return index >= from && index <= to;
}

function handleTabColumnClick(index, event) {
  if (event.shiftKey && tabSelection) {
    tabSelection = { start: tabSelection.start, end: index };
  } else if (tabSelection && isIndexInSelection(index, tabSelection)) {
    tabSelection = null;
  } else {
    tabSelection = { start: index, end: index };
  }
  renderTabView();
}

// 再生中の全トラックを停止し、UIを停止状態へ戻す
function stopTabPlayback() {
  const session = playbackSession;
  playbackSession = null; // 以後、このセッションのコールバックはすべて無効になる
  // 1トラックの停止で例外が起きても残りのトラックは必ず止める。止め損ねた音が残ったまま
  // 停止状態のUIに戻ると、次に再生したときに前回の音と重なって鳴ってしまうため
  session?.tracks.forEach((track) => {
    try {
      track.handle?.stop();
    } catch (error) {
      console.error(error);
    }
  });
  playingIndex = null;
  tabPlayBtn.textContent = '再生';
  render();
}

function startTabPlayback() {
  // 直前のセッションが何らかの理由で残っている場合に備え、必ず止めてから始める(多重再生の防止)
  if (playbackSession) stopTabPlayback();

  // 同時再生の対象はあくまで「他TAB」。アクティブTABが混ざると二重に発音されるため明示的に除外する
  const others = tabLibrary.tabs.filter((t) => t.id !== tabData.id && simultaneousTabIds.has(t.id));
  if (tabData.notes.length === 0 && others.length === 0) return;

  // アクティブTABは選択位置(複数選択時は選択範囲の先頭)からそのまま再生する。
  // 他TABはリズムが異なりインデックスの対応が取れないため、アクティブTABの開始位置を
  // 拍数に変換し、その拍数に対応する自TAB内の位置から再生することで同期を保つ
  const startIndex = tabSelection ? Math.min(tabSelection.start, tabSelection.end) : 0;
  const targetBeats = beatsBeforeIndex(tabData.notes, startIndex);

  const session = { tracks: [], pending: 0 };
  // スケジューリング途中で例外が起きても、それまでに鳴り始めたトラックを停止できるよう
  // 先にセッションを保持しておく(停止手段を失った音が残ると次の再生と重なってしまう)
  playbackSession = session;

  function addTrack(tab, isActive, options) {
    const track = { handle: null, finished: false, isActive };
    session.tracks.push(track);
    session.pending += 1;
    track.handle = playTab(tab, tab.tuning, {
      tempo: state.tempo,
      timeSignature: state.timeSignature,
      octaveUp: state.tabOctaveUp,
      ...options,
      onEnd: () => finishTrack(session, track),
    });
  }

  try {
    addTrack(tabData, true, {
      metronome: state.tabMetronome,
      startIndex,
      onNoteStart: (index) => {
        if (session !== playbackSession) return;
        updatePlayingIndex(index);
      },
    });

    others.forEach((otherTab) => {
      const otherStartIndex = indexAtBeats(otherTab.notes, targetBeats);
      if (otherStartIndex >= otherTab.notes.length) return; // この時点で既に演奏が終わっているTABは再生しない
      addTrack(otherTab, false, { metronome: false, startIndex: otherStartIndex });
    });
  } catch (error) {
    console.error(error);
    stopTabPlayback(); // 中途半端に鳴り始めた音を残さない
    showToast('再生を開始できませんでした。');
    return;
  }

  tabPlayBtn.textContent = '停止';
  renderTabBar();
  renderSimulPlayList();
  syncTabJsonView();
}

// 1トラック分の再生終了。同時再生では、アクティブTABが先に終わっても他TABが鳴り続けている間は
// 再生中(停止ボタン)のままにし、全トラックが終わって初めて停止状態へ戻す
function finishTrack(session, track) {
  if (session !== playbackSession || track.finished) return;
  track.finished = true;
  session.pending -= 1;

  if (session.pending <= 0) {
    stopTabPlayback();
    return;
  }

  // アクティブTAB自身の演奏だけが終わった場合は、再生位置ハイライトを消して他TABの再生を続ける
  if (track.isActive) {
    updatePlayingIndex(null);
  }
}

function syncTabButtons() {
  const hasSelection = Boolean(tabSelection);
  const isPair = hasSelection && Math.abs(tabSelection.end - tabSelection.start) === 1;
  const pairIndex = isPair ? Math.min(tabSelection.start, tabSelection.end) : null;

  tabDeleteBtn.disabled = !hasSelection;
  tabCopyBtn.disabled = !hasSelection;
  tabPasteBtn.disabled = !tabClipboard;
  tabUndoBtn.disabled = tabHistory.past.length === 0;
  tabRedoBtn.disabled = tabHistory.future.length === 0;

  const tieOk = isPair && canTie(tabData.notes, pairIndex);
  const hpOk = isPair && canHammerPull(tabData.notes, pairIndex);
  const slideOk = isPair && canSlide(tabData.notes, pairIndex, tabData.tuning);
  const tupletOk = hasSelection && canTuplet(tabData.notes, tabSelection.start, tabSelection.end);

  tabTieBtn.disabled = !tieOk;
  tabHammerPullBtn.disabled = !hpOk;
  tabSlideBtn.disabled = !slideOk;
  tabTupletBtn.disabled = !tupletOk;

  tabTieBtn.classList.toggle('active', tieOk && tabData.notes[pairIndex]?.articulation === 'tie');
  tabHammerPullBtn.classList.toggle(
    'active',
    hpOk && ['hammerOn', 'pullOff'].includes(tabData.notes[pairIndex]?.articulation)
  );
  tabSlideBtn.classList.toggle('active', slideOk && tabData.notes[pairIndex]?.articulation === 'slide');
  if (tupletOk) {
    const from = Math.min(tabSelection.start, tabSelection.end);
    const to = Math.max(tabSelection.start, tabSelection.end);
    const size = to - from + 1;
    const tupleted = tabData.notes.slice(from, to + 1).every((n) => n.tuplet === size);
    tabTupletBtn.classList.toggle('active', tupleted);
  } else {
    tabTupletBtn.classList.remove('active');
  }

  [...durationButtonsEl.children].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.duration === selectedDuration);
  });

  tabPlayBtn.disabled = tabData.notes.length === 0 && simultaneousTabIds.size === 0 && !isTabPlaying();
}

function renderTabView() {
  tabTitleInput.value = tabData.partName;
  renderTab(
    tabDisplay,
    {
      tabData,
      tuning: tabData.tuning,
      timeSignature: state.timeSignature,
      selection: tabSelection,
      playingIndex,
      key: state.key,
      scale: state.scale,
      displayMode: state.displayMode,
      colorSync: state.tabColorSync,
    },
    { onColumnClick: handleTabColumnClick }
  );
  syncTabButtons();
  scrollTabIntoView();
  syncTabJsonView();
}

// 再生位置・選択位置・末尾への新規入力に合わせて、TAB表示エリアの横スクロールを追従させる
function scrollTabIntoView() {
  const isPlaying = playingIndex != null;
  const focusIndex = playingIndex ?? (tabSelection ? tabSelection.end : tabData.notes.length - 1);
  if (focusIndex == null || focusIndex < 0) return;
  // 再生中は先の音符を見越しやすいよう、再生中の音符を表示エリアの中央に寄せる
  getColumnElement(focusIndex)?.scrollIntoView({ inline: isPlaying ? 'center' : 'nearest', block: 'nearest' });
}

// 再生位置の移動。音符ごとにTAB表示エリア全体を作り直すと、音符数の多い譜面では1音ごとに
// 数千要素の再生成が走って再生中の操作を受け付けられなくなるため、実際に変化する
// 「ハイライトされる列」「スクロール位置」「JSON編集エリアの選択範囲」だけを更新する
function updatePlayingIndex(index) {
  playingIndex = index;
  setPlayingColumn(index);
  scrollTabIntoView();
  syncTabJsonPlayingRange();
}

// --- JSON直接編集 ---

function isFlatObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// {"key":"value",...} → {"key": "value", ...} のようにコロン・カンマの後ろにスペースを補う(1オブジェクト1行表示用)。
// 和音の`notes`のようなネストしたオブジェクト配列(...},{...)の区切りにもスペースを補う
function formatFlatObjectLine(obj) {
  return JSON.stringify(obj).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/\},\{/g, '}, {');
}

// notes配列を1音符1行で整形しつつ、TAB表示上の小節の区切りに合わせて空行を挿入する
function formatNotesArrayLines(notes, timeSignature, suffix) {
  if (notes.length === 0) return [`  "notes": []${suffix}`];

  const measureEndIndices = new Set(computeMeasures(notes, timeSignature).map((m) => m.endIndex));
  const lines = ['  "notes": ['];
  notes.forEach((item, j) => {
    const isLast = j === notes.length - 1;
    lines.push(`    ${formatFlatObjectLine(item)}${isLast ? '' : ','}`);
    if (!isLast && measureEndIndices.has(j)) lines.push('');
  });
  lines.push(`  ]${suffix}`);
  return lines;
}

// tabDataをJSON整形するが、3階層目(notes/tuningの各要素)のオブジェクトは
// 1要素ごとに視認しやすいよう1行にまとめて出力する(notesは小節の区切りに空行を挿入する)
function formatTabDataJson(data, timeSignature) {
  const keys = Object.keys(data);
  const lines = ['{'];
  keys.forEach((key, i) => {
    const value = data[key];
    const suffix = i === keys.length - 1 ? '' : ',';
    if (key === 'notes' && Array.isArray(value)) {
      lines.push(...formatNotesArrayLines(value, timeSignature, suffix));
    } else if (Array.isArray(value) && value.length > 0 && value.every(isFlatObject)) {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((item, j) => {
        lines.push(`    ${formatFlatObjectLine(item)}${j === value.length - 1 ? '' : ','}`);
      });
      lines.push(`  ]${suffix}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${suffix}`);
    }
  });
  lines.push('}');
  return lines.join('\n');
}

// 整形済みJSON文字列中の "notes" 配列の各要素([開始オフセット, 終了オフセット])を、
// 文字列/括弧のネストを考慮しつつ走査して求める(notes配列のインデックスと1対1で対応する)
function computeNoteJsonRanges(jsonText) {
  const bracketStart = jsonText.indexOf('[', jsonText.indexOf('"notes"'));
  if (bracketStart === -1) return [];

  const ranges = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let elementStart = -1;

  for (let i = bracketStart; i < jsonText.length; i++) {
    const ch = jsonText[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[' || ch === '{') {
      if (depth === 1 && ch === '{') elementStart = i;
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 1 && ch === '}') ranges.push([elementStart, i + 1]);
      if (depth === 0 && ch === ']') break;
    }
  }
  return ranges;
}

function setTabJsonError(message) {
  tabJsonError.textContent = message;
  tabJsonError.classList.toggle('visible', Boolean(message));
}

// 表示中のJSONテキストに対する音符ごとの文字範囲と行番号。テキストを組み立て直したときだけ
// 作り直し、再生位置の移動では使い回す(1音ごとに数十万文字を走査し直さないため)
let tabJsonRanges = [];
let tabJsonLineOfRange = [];

function cacheTabJsonRanges(text) {
  tabJsonRanges = computeNoteJsonRanges(text);
  // 各範囲の開始オフセットが何行目かを、テキスト1回の走査でまとめて求める
  tabJsonLineOfRange = [];
  let line = 0;
  let cursor = 0;
  tabJsonRanges.forEach(([start], i) => {
    while (cursor < start) {
      if (text.charCodeAt(cursor) === 10) line++;
      cursor++;
    }
    tabJsonLineOfRange[i] = line;
  });
}

// テキストエリア内で、指定した行が一番上に来るようスクロールする
function scrollTabJsonToLine(lineIndex) {
  const lineHeight = parseFloat(getComputedStyle(tabJsonTextarea).lineHeight) || 18;
  const target = Math.max(0, lineIndex * lineHeight);
  tabJsonTextarea.scrollTop = target;
  // setSelectionRangeによるキャレット追従スクロールが次の描画で上書きすることがあるため再適用する
  requestAnimationFrame(() => {
    tabJsonTextarea.scrollTop = target;
  });
}

// 再生位置に対応する箇所のハイライトだけを更新する(テキストの再生成・再走査は行わない)
function syncTabJsonPlayingRange() {
  if (!tabJsonDetails.open || document.activeElement === tabJsonTextarea) return;
  if (playingIndex == null) return;
  const range = tabJsonRanges[playingIndex];
  if (!range) return;
  tabJsonTextarea.setSelectionRange(range[0], range[1]);
  scrollTabJsonToLine(tabJsonLineOfRange[playingIndex]);
}

function syncTabJsonView() {
  tabJsonTextarea.disabled = isTabPlaying();
  if (!tabJsonDetails.open) return;
  if (document.activeElement === tabJsonTextarea) return; // 編集中は上書きしない(カーソル位置を保持)

  const text = formatTabDataJson(tabData, state.timeSignature);
  tabJsonTextarea.value = text;
  setTabJsonError('');
  cacheTabJsonRanges(text);

  const ranges = tabJsonRanges;
  if (playingIndex != null && ranges[playingIndex]) {
    syncTabJsonPlayingRange();
  } else if (tabSelection) {
    const from = Math.min(tabSelection.start, tabSelection.end);
    const to = Math.max(tabSelection.start, tabSelection.end);
    if (ranges[from] && ranges[to]) {
      tabJsonTextarea.setSelectionRange(ranges[from][0], ranges[to][1]);
      scrollTabJsonToLine(tabJsonLineOfRange[from]);
    }
  } else {
    tabJsonTextarea.setSelectionRange(0, 0);
  }
}

function isValidImportedTuning(value) {
  return (
    Array.isArray(value) &&
    value.length >= MIN_STRINGS &&
    value.length <= MAX_STRINGS &&
    value.every(
      (s) =>
        s &&
        typeof s === 'object' &&
        NOTE_NAMES.includes(s.name) &&
        Number.isInteger(s.octave) &&
        OCTAVE_OPTIONS.includes(s.octave)
    )
  );
}

function applyTabJsonText(rawText) {
  if (isTabPlaying()) return;

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    setTabJsonError(`JSON構文エラー: ${e.message}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.notes)) {
    setTabJsonError('notes配列を含むTABデータの形式である必要があります。');
    return;
  }

  setTabJsonError('');
  const maxIndex = parsed.notes.length - 1;
  if (tabSelection && (tabSelection.start > maxIndex || tabSelection.end > maxIndex)) {
    tabSelection = null;
  }

  const nextTabData = {
    id: tabData.id,
    partName: typeof parsed.partName === 'string' ? parsed.partName : tabData.partName,
    tuning: isValidImportedTuning(parsed.tuning) ? parsed.tuning.map((s) => ({ ...s })) : tabData.tuning,
    fretCount: Number.isFinite(parsed.fretCount) ? clampFretCount(parsed.fretCount) : tabData.fretCount,
    notes: parsed.notes.map(migrateEntry),
  };
  tabHistory = pushHistory(tabHistory, nextTabData);
  tabData = tabHistory.present;
  syncTabLibrary();
  syncControlsFromState();
  renderStringList();
  render();
}

tabRestBtn.addEventListener('click', () => {
  const entry = createRestEntry(selectedDuration, dottedInput);
  const singleSelected =
    tabSelection && tabSelection.start === tabSelection.end ? tabSelection.start : undefined;
  commitTab({ notes: insertEntry(tabData.notes, entry, singleSelected) });
  tabSelection = singleSelected !== undefined ? { start: singleSelected + 1, end: singleSelected + 1 } : null;
  renderTabView();
});

tabGhostBtn.addEventListener('click', () => {
  pendingInputMode = pendingInputMode === 'ghost' ? 'note' : 'ghost';
  syncGhostButton();
});

tabChordBtn.addEventListener('click', () => {
  // 複数の既入力音符を選択している場合は、和音入力モードの切り替えではなく
  // それらを1つの和音エントリへ統合する(揃っていない場合は何もしない)
  if (tabSelection && canMergeChord(tabData.notes, tabSelection.start, tabSelection.end)) {
    const mergedIndex = Math.min(tabSelection.start, tabSelection.end);
    commitTab({ notes: mergeToChord(tabData.notes, tabSelection.start, tabSelection.end) });
    tabSelection = { start: mergedIndex, end: mergedIndex };
    renderTabView();
    return;
  }

  chordInputMode = !chordInputMode;
  syncChordButton();
});

tabDottedBtn.addEventListener('click', () => {
  dottedInput = !dottedInput;
  if (tabSelection) {
    commitTab({ notes: setDottedRange(tabData.notes, tabSelection.start, tabSelection.end, dottedInput) });
  }
  syncDottedButton();
  renderTabView();
});

tabTieBtn.addEventListener('click', () => {
  if (tabTieBtn.disabled) return;
  const pairIndex = Math.min(tabSelection.start, tabSelection.end);
  commitTab({ notes: toggleTieAt(tabData.notes, pairIndex) });
  renderTabView();
});

tabHammerPullBtn.addEventListener('click', () => {
  if (tabHammerPullBtn.disabled) return;
  const pairIndex = Math.min(tabSelection.start, tabSelection.end);
  commitTab({ notes: toggleHammerPullAt(tabData.notes, pairIndex) });
  renderTabView();
});

tabSlideBtn.addEventListener('click', () => {
  if (tabSlideBtn.disabled) return;
  const pairIndex = Math.min(tabSelection.start, tabSelection.end);
  commitTab({ notes: toggleSlideAt(tabData.notes, pairIndex, tabData.tuning) });
  renderTabView();
});

tabTupletBtn.addEventListener('click', () => {
  if (tabTupletBtn.disabled) return;
  commitTab({ notes: toggleTupletAt(tabData.notes, tabSelection.start, tabSelection.end) });
  renderTabView();
});

tabDeleteBtn.addEventListener('click', () => {
  if (!tabSelection) return;
  const deletedAt = Math.min(tabSelection.start, tabSelection.end);
  const newNotes = removeRange(tabData.notes, tabSelection.start, tabSelection.end);
  commitTab({ notes: newNotes });

  if (newNotes.length === 0) {
    tabSelection = null;
  } else {
    // 削除位置の音符(繰り上がってきたもの)を選択。末尾を削除した場合は新しい末尾を選択する
    const nextIndex = Math.min(deletedAt, newNotes.length - 1);
    tabSelection = { start: nextIndex, end: nextIndex };
  }
  renderTabView();
});

tabUndoBtn.addEventListener('click', () => {
  tabHistory = undoHistory(tabHistory);
  tabData = tabHistory.present;
  tabSelection = null;
  syncTabLibrary();
  syncControlsFromState();
  renderStringList();
  render();
});

tabRedoBtn.addEventListener('click', () => {
  tabHistory = redoHistory(tabHistory);
  tabData = tabHistory.present;
  tabSelection = null;
  syncTabLibrary();
  syncControlsFromState();
  renderStringList();
  render();
});

tabCopyBtn.addEventListener('click', () => {
  if (!tabSelection) return;
  tabClipboard = cloneRange(tabData.notes, tabSelection.start, tabSelection.end);
  renderTabView();
});

tabPasteBtn.addEventListener('click', () => {
  if (!tabClipboard) return;
  const afterIndex = tabSelection ? Math.max(tabSelection.start, tabSelection.end) : undefined;
  const insertAt = afterIndex === undefined ? tabData.notes.length : afterIndex + 1;
  commitTab({ notes: insertEntries(tabData.notes, tabClipboard, afterIndex) });
  tabSelection = { start: insertAt, end: insertAt + tabClipboard.length - 1 };
  renderTabView();
});

tabTitleInput.addEventListener('change', () => {
  commitTab({ partName: tabTitleInput.value.trim() || 'パート未設定' });
  renderTabView();
  renderTabBar();
});

songTitleInput.addEventListener('change', () => {
  state.songTitle = songTitleInput.value.trim() || '曲名未設定';
  songTitleInput.value = state.songTitle;
  persist();
});

tempoInput.addEventListener('change', () => {
  state.tempo = Math.min(300, Math.max(20, Number(tempoInput.value) || 120));
  tempoInput.value = state.tempo;
  persist();
});

timeSignatureInput.addEventListener('change', () => {
  const value = timeSignatureInput.value.trim();
  if (/^\d+\/\d+$/.test(value)) {
    state.timeSignature = value;
  }
  timeSignatureInput.value = state.timeSignature;
  persistAndRender();
});

tabMetronomeBtn.addEventListener('click', () => {
  state.tabMetronome = !state.tabMetronome;
  syncTabMetronomeButton();
  persist();
});

tabOctaveUpBtn.addEventListener('click', () => {
  state.tabOctaveUp = !state.tabOctaveUp;
  syncTabOctaveUpButton();
  persist();
});

tabColorSyncBtn.addEventListener('click', () => {
  state.tabColorSync = !state.tabColorSync;
  syncTabColorSyncButton();
  persist();
  renderTabView();
});

tabPlayBtn.addEventListener('click', () => {
  if (isTabPlaying()) {
    stopTabPlayback();
    return;
  }
  startTabPlayback();
});

// 画面上部の設定(セクション5でlocalStorageに保存している項目)のスナップショット
function settingsSnapshot() {
  return {
    songTitle: state.songTitle,
    key: state.key,
    scale: state.scale,
    displayMode: state.displayMode,
    masterVolume: state.masterVolume,
    tempo: state.tempo,
    timeSignature: state.timeSignature,
    tabOctaveUp: state.tabOctaveUp,
    tabColorSync: state.tabColorSync,
    tabMetronome: state.tabMetronome,
  };
}

const SETTINGS_FIELD_LABELS = {
  songTitle: '曲名',
  key: 'キー',
  scale: 'スケール',
  displayMode: '表示モード',
  masterVolume: '音量',
  tempo: 'テンポ',
  timeSignature: '拍子',
  tabOctaveUp: 'TABオクターブ上げ再生',
  tabColorSync: 'TABスケール配色連動',
  tabMetronome: 'メトロノーム',
};

// settingsの各項目を個別に検証し、有効な項目だけstateへ反映する。
// 項目が未指定なら何もしない(旧形式ファイル等)。値はあるが不正・非対応なら
// その項目だけスキップし、呼び出し側への通知用にラベルを返す
function applyImportedSettings(settings) {
  const skipped = [];

  if (settings.songTitle !== undefined) {
    if (typeof settings.songTitle === 'string' && settings.songTitle.trim()) {
      state.songTitle = settings.songTitle;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.songTitle);
    }
  }

  if (settings.key !== undefined) {
    if (NOTE_NAMES.includes(settings.key)) {
      state.key = settings.key;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.key);
    }
  }

  if (settings.scale !== undefined) {
    if (SCALE_LIST.some((s) => s.id === settings.scale)) {
      state.scale = settings.scale;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.scale);
    }
  }

  if (settings.displayMode !== undefined) {
    if (settings.displayMode === 'scale' || settings.displayMode === 'function') {
      state.displayMode = settings.displayMode;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.displayMode);
    }
  }

  if (settings.masterVolume !== undefined) {
    if (Number.isFinite(settings.masterVolume) && settings.masterVolume >= 0 && settings.masterVolume <= 1) {
      state.masterVolume = settings.masterVolume;
      setMasterVolume(state.masterVolume);
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.masterVolume);
    }
  }

  if (settings.tempo !== undefined) {
    if (Number.isFinite(settings.tempo) && settings.tempo >= 20 && settings.tempo <= 300) {
      state.tempo = settings.tempo;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.tempo);
    }
  }

  if (settings.timeSignature !== undefined) {
    if (typeof settings.timeSignature === 'string' && /^\d+\/\d+$/.test(settings.timeSignature)) {
      state.timeSignature = settings.timeSignature;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.timeSignature);
    }
  }

  if (settings.tabOctaveUp !== undefined) {
    if (typeof settings.tabOctaveUp === 'boolean') {
      state.tabOctaveUp = settings.tabOctaveUp;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.tabOctaveUp);
    }
  }

  if (settings.tabColorSync !== undefined) {
    if (typeof settings.tabColorSync === 'boolean') {
      state.tabColorSync = settings.tabColorSync;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.tabColorSync);
    }
  }

  if (settings.tabMetronome !== undefined) {
    if (typeof settings.tabMetronome === 'boolean') {
      state.tabMetronome = settings.tabMetronome;
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.tabMetronome);
    }
  }

  return skipped;
}

const TOAST_DURATION_MS = 6000;

// モーダルではなく画面上部に非モーダルのポップアップ通知を表示する。時間経過または×クリックで消える
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', '通知を閉じる');

  toast.append(text, closeBtn);
  toastContainer.appendChild(toast);

  const timer = setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  closeBtn.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
  });
}

tabExportBtn.addEventListener('click', () => {
  const payload = { tab: tabData, settings: settingsSnapshot() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.songTitle || 'song'}-${tabData.partName || 'part'}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

tabImportBtn.addEventListener('click', () => tabImportInput.click());

tabImportInput.addEventListener('change', async () => {
  const file = tabImportInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // 新形式({tab, settings})・旧形式(tabDataそのもの)のどちらもTAB本体はそのまま取り込む
    const tabSource = parsed && typeof parsed === 'object' && parsed.tab && typeof parsed.tab === 'object'
      ? parsed.tab
      : parsed;
    if (!tabSource || !Array.isArray(tabSource.notes)) throw new Error('invalid tab data');

    const settingsSource =
      parsed && typeof parsed === 'object' && parsed.settings && typeof parsed.settings === 'object'
        ? parsed.settings
        : null;

    // 新形式はtab側にtuning/fretCountを持つが、旧形式はsettings側に持っていたためフォールバックする
    const tuningFallback = isValidImportedTuning(settingsSource?.tuning) ? settingsSource.tuning : undefined;
    const fretCountFallback = Number.isFinite(settingsSource?.fretCount) ? settingsSource.fretCount : undefined;

    // importは既存のアクティブTABを上書きせず、新規TABとして追加してアクティブにする。
    // tuning/fretCountはcreateTabData()の既定値で「埋まってしまう」と旧形式ファイル(tabSourceに
    // これらのキーが無い)かどうかをmigrateTabDataが判定できなくなるため、tabSourceの値(無ければ
    // undefined)で明示的に上書きしてから渡す
    const newTab = migrateTabData(
      { ...createTabData(), ...tabSource, tuning: tabSource.tuning, fretCount: tabSource.fretCount },
      { tuning: tuningFallback, fretCount: fretCountFallback }
    );
    tabLibrary = addTabToLibrary(tabLibrary, newTab);
    switchToTab(newTab.id);

    const skipped = settingsSource ? applyImportedSettings(settingsSource) : [];

    // 旧形式はtempo/timeSignatureがtab側にあったため、settings側で指定されていなければそちらを採用する
    if (!settingsSource || settingsSource.tempo === undefined) {
      const legacyTempo = legacyTempoOf(tabSource);
      if (legacyTempo != null) state.tempo = legacyTempo;
    }
    if (!settingsSource || settingsSource.timeSignature === undefined) {
      const legacyTimeSignature = legacyTimeSignatureOf(tabSource);
      if (legacyTimeSignature != null) state.timeSignature = legacyTimeSignature;
    }

    syncControlsFromState();
    renderStringList();
    saveSettings(state);
    if (skipped.length > 0) {
      showToast(`一部の設定を読み込めなかったため現在の設定を維持しました: ${skipped.join('、')}`);
    }

    render();
  } catch (e) {
    console.warn('TAB譜のインポートに失敗しました。', e);
    window.alert('TAB譜ファイルの読み込みに失敗しました。ファイル形式を確認してください。');
  } finally {
    tabImportInput.value = '';
  }
});

tabJsonDetails.addEventListener('toggle', () => {
  if (tabJsonDetails.open) syncTabJsonView();
});

let tabJsonApplyTimer = null;

tabJsonTextarea.addEventListener('input', () => {
  clearTimeout(tabJsonApplyTimer);
  const value = tabJsonTextarea.value;
  tabJsonApplyTimer = setTimeout(() => applyTabJsonText(value), 400);
});

tabJsonTextarea.addEventListener('change', () => {
  clearTimeout(tabJsonApplyTimer);
  // blur(change)はクリック操作のフォーカス移動処理中に同期発火するため、
  // 直後に発生しうるTAB側のクリック処理(DOM再構築)と競合しないよう次タスクへ遅延させる
  setTimeout(() => applyTabJsonText(tabJsonTextarea.value), 0);
});

function debounce(fn, waitMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

tabAddBtn.addEventListener('click', () => {
  if (isTabPlaying()) return;
  newTabPartNameInput.value = '';
  newTabPresetSelect.value = TUNING_PRESETS[0].id;
  newTabDialog.showModal();
});

newTabCancelBtn.addEventListener('click', () => {
  newTabDialog.close();
});

newTabForm.addEventListener('submit', () => {
  const preset = findPreset(newTabPresetSelect.value) || TUNING_PRESETS[0];
  const partName = newTabPartNameInput.value.trim() || 'パート未設定';
  const newTab = createTabData({ partName, tuning: preset.strings.map((s) => ({ ...s })) });
  tabLibrary = addTabToLibrary(tabLibrary, newTab);
  switchToTab(newTab.id);
});

populateStaticSelects();
syncControlsFromState();
renderStringList();
populateDurationButtons();
syncGhostButton();
syncChordButton();
syncDottedButton();
setMasterVolume(state.masterVolume);
render();

keySelect.addEventListener('change', () => {
  state.key = keySelect.value;
  persistAndRender();
});

scaleSelect.addEventListener('change', () => {
  state.scale = scaleSelect.value;
  persistAndRender();
});

presetSelect.addEventListener('change', () => {
  const preset = findPreset(presetSelect.value);
  if (!preset) return;
  commitTab({ tuning: preset.strings.map((s) => ({ ...s })) });
  render();
  renderStringList();
});

fretCountInput.addEventListener('change', () => {
  const fretCount = clampFretCount(Number(fretCountInput.value) || 1);
  fretCountInput.value = fretCount;
  commitTab({ fretCount });
  render();
});

addStringBtn.addEventListener('click', () => {
  commitTab({ tuning: addString(tabData.tuning) });
  presetSelect.value = CUSTOM_PRESET_VALUE;
  render();
  renderStringList();
});

tuningDetailBtn.addEventListener('click', () => {
  tuningDialog.showModal();
});

displayModeToggle.addEventListener('click', () => {
  state.displayMode = state.displayMode === 'function' ? 'scale' : 'function';
  syncDisplayModeToggle();
  persistAndRender();
});

masterVolumeInput.addEventListener('input', () => {
  state.masterVolume = Number(masterVolumeInput.value);
  setMasterVolume(state.masterVolume);
  persist();
});

window.addEventListener('resize', debounce(render, 150));
