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
import { loadSettings, saveSettings, loadTabLibrary, saveTabLibrary } from './storage.js';
import { playFrequency, setMasterVolume } from './audio.js';
import { renderFretboard } from './render.js';
import {
  DURATION_LIST,
  createTabData,
  createNoteEntry,
  createRestEntry,
  createGhostEntry,
  insertEntry,
  insertEntries,
  removeRange,
  setDurationRange,
  setDottedRange,
  canTie,
  canHammerPull,
  canSlide,
  toggleTieAt,
  toggleHammerPullAt,
  toggleSlideAt,
  cloneRange,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  computeMeasures,
} from './tab.js';
import { renderTab } from './tabRender.js';
import { playTab } from './tabPlayback.js';

const OCTAVE_OPTIONS = [0, 1, 2, 3, 4, 5, 6];
const CUSTOM_PRESET_VALUE = 'custom';

const state = loadSettings();

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

const tabTitleInput = document.getElementById('tab-title-input');
const tabTempoInput = document.getElementById('tab-tempo-input');
const durationButtonsEl = document.getElementById('duration-buttons');
const tabRestBtn = document.getElementById('tab-rest-btn');
const tabDottedBtn = document.getElementById('tab-dotted-btn');
const tabGhostBtn = document.getElementById('tab-ghost-btn');
const tabTieBtn = document.getElementById('tab-tie-btn');
const tabHammerPullBtn = document.getElementById('tab-hammer-pull-btn');
const tabSlideBtn = document.getElementById('tab-slide-btn');
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

let tabLibrary = loadTabLibrary();
let tabData = tabLibrary.tabs[0];
let tabHistory = createHistory(tabData);
let tabSelection = null; // {start, end} (notesへのインデックス範囲、順不同)
let tabClipboard = null;
let selectedDuration = 'quarter';
let dottedInput = false;
let pendingInputMode = 'note'; // 'note' | 'ghost'
let metronomeOn = false;
let playbackHandle = null;
let playingIndex = null;

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
}

function sameTuning(a, b) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.name === b[i].name && s.octave === b[i].octave);
}

function syncControlsFromState() {
  keySelect.value = state.key;
  scaleSelect.value = state.scale;
  fretCountInput.value = state.fretCount;
  const matchedPreset = TUNING_PRESETS.find((p) => sameTuning(p.strings, state.tuning));
  presetSelect.value = matchedPreset ? matchedPreset.id : CUSTOM_PRESET_VALUE;
  syncDisplayModeToggle();
  masterVolumeInput.value = String(state.masterVolume);
  syncTabOctaveUpButton();
  syncTabColorSyncButton();
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
  renderFretboard(fretboardContainer, state, {
    onNoteClick: (stringIndex, fret, note) => {
      playFrequency(frequencyOf(note.name, note.octave));
      handleFretboardNoteInput(stringIndex, fret);
    },
  });
  renderLegend();
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

  // 1弦(高音弦)がフレットボード上部・リスト先頭に来るよう、低音→高音順のstate.tuningを逆順表示する
  const total = state.tuning.length;
  [...state.tuning].reverse().forEach((s, displayIndex) => {
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
      state.tuning = updateString(state.tuning, index, { name: nameSelect.value });
      presetSelect.value = CUSTOM_PRESET_VALUE;
      persistAndRender();
    });

    const octaveSelect = document.createElement('select');
    octaveSelect.replaceChildren(...OCTAVE_OPTIONS.map((o) => new Option(String(o), String(o))));
    octaveSelect.value = String(s.octave);
    octaveSelect.addEventListener('change', () => {
      state.tuning = updateString(state.tuning, index, { octave: Number(octaveSelect.value) });
      presetSelect.value = CUSTOM_PRESET_VALUE;
      persistAndRender();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '削除';
    removeBtn.disabled = state.tuning.length <= MIN_STRINGS;
    removeBtn.addEventListener('click', () => {
      state.tuning = removeString(state.tuning, index);
      presetSelect.value = CUSTOM_PRESET_VALUE;
      persistAndRender();
      renderStringList();
    });

    row.append(label, nameSelect, octaveSelect, removeBtn);
    stringListEl.appendChild(row);
  });

  addStringBtn.disabled = state.tuning.length >= MAX_STRINGS;
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

function syncDottedButton() {
  tabDottedBtn.classList.toggle('active', dottedInput);
  tabDottedBtn.setAttribute('aria-pressed', String(dottedInput));
}

function syncTabLibrary() {
  tabLibrary = { ...tabLibrary, tabs: [tabData] };
  saveTabLibrary(tabLibrary);
}

// notes配列以外も含めた変更(title/tempoEvents等)をまとめて履歴に積んでコミットする
function commitTab(partialChanges) {
  const nextTabData = { ...tabData, ...partialChanges };
  tabHistory = pushHistory(tabHistory, nextTabData);
  tabData = tabHistory.present;
  syncTabLibrary();
}

function handleFretboardNoteInput(stringIndex, fret) {
  const isGhost = pendingInputMode === 'ghost';
  const entry = isGhost
    ? createGhostEntry({ string: stringIndex, fret, duration: selectedDuration, dotted: dottedInput })
    : createNoteEntry({ string: stringIndex, fret, duration: selectedDuration, dotted: dottedInput });

  const singleSelected =
    tabSelection && tabSelection.start === tabSelection.end ? tabSelection.start : undefined;
  commitTab({ notes: insertEntry(tabData.notes, entry, singleSelected) });

  tabSelection = singleSelected !== undefined ? { start: singleSelected + 1, end: singleSelected + 1 } : null;
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

function stopTabPlayback() {
  playbackHandle?.stop();
  playbackHandle = null;
  playingIndex = null;
  tabPlayBtn.textContent = '再生';
  renderTabView();
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
  const slideOk = isPair && canSlide(tabData.notes, pairIndex, state.tuning);

  tabTieBtn.disabled = !tieOk;
  tabHammerPullBtn.disabled = !hpOk;
  tabSlideBtn.disabled = !slideOk;

  tabTieBtn.classList.toggle('active', tieOk && tabData.notes[pairIndex]?.articulation === 'tie');
  tabHammerPullBtn.classList.toggle(
    'active',
    hpOk && ['hammerOn', 'pullOff'].includes(tabData.notes[pairIndex]?.articulation)
  );
  tabSlideBtn.classList.toggle('active', slideOk && tabData.notes[pairIndex]?.articulation === 'slide');

  [...durationButtonsEl.children].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.duration === selectedDuration);
  });

  tabPlayBtn.disabled = tabData.notes.length === 0 && !playbackHandle;
}

function renderTabView() {
  tabTitleInput.value = tabData.title;
  tabTempoInput.value = tabData.tempoEvents[0]?.bpm ?? 120;
  renderTab(
    tabDisplay,
    {
      tabData,
      tuning: state.tuning,
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
  const col = tabDisplay.querySelectorAll('.tab-col')[focusIndex];
  // 再生中は先の音符を見越しやすいよう、再生中の音符を表示エリアの中央に寄せる
  col?.scrollIntoView({ inline: isPlaying ? 'center' : 'nearest', block: 'nearest' });
}

// --- JSON直接編集 ---

function isFlatObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// {"key":"value",...} → {"key": "value", ...} のようにコロン・カンマの後ろにスペースを補う(1オブジェクト1行表示用)
function formatFlatObjectLine(obj) {
  return JSON.stringify(obj).replace(/":/g, '": ').replace(/,"/g, ', "');
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

// tabDataをJSON整形するが、3階層目(notes/tempoEventsの各要素)のオブジェクトは
// 1音符・1イベントごとに視認しやすいよう1行にまとめて出力する(notesは小節の区切りに空行を挿入する)
function formatTabDataJson(data) {
  const keys = Object.keys(data);
  const lines = ['{'];
  keys.forEach((key, i) => {
    const value = data[key];
    const suffix = i === keys.length - 1 ? '' : ',';
    if (key === 'notes' && Array.isArray(value)) {
      lines.push(...formatNotesArrayLines(value, data.timeSignature, suffix));
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

// テキストエリア内でrangeStartを含む行の先頭が一番上に来るようスクロールする
function scrollTabJsonToOffset(text, offset) {
  const lineIndex = (text.slice(0, offset).match(/\n/g) || []).length;
  const lineHeight = parseFloat(getComputedStyle(tabJsonTextarea).lineHeight) || 18;
  const target = Math.max(0, lineIndex * lineHeight);
  tabJsonTextarea.scrollTop = target;
  // setSelectionRangeによるキャレット追従スクロールが次の描画で上書きすることがあるため再適用する
  requestAnimationFrame(() => {
    tabJsonTextarea.scrollTop = target;
  });
}

function syncTabJsonView() {
  tabJsonTextarea.disabled = Boolean(playbackHandle);
  if (!tabJsonDetails.open) return;
  if (document.activeElement === tabJsonTextarea) return; // 編集中は上書きしない(カーソル位置を保持)

  const text = formatTabDataJson(tabData);
  tabJsonTextarea.value = text;
  setTabJsonError('');

  const ranges = computeNoteJsonRanges(text);
  if (playingIndex != null && ranges[playingIndex]) {
    const [start, end] = ranges[playingIndex];
    tabJsonTextarea.setSelectionRange(start, end);
    scrollTabJsonToOffset(text, start);
  } else if (tabSelection) {
    const from = Math.min(tabSelection.start, tabSelection.end);
    const to = Math.max(tabSelection.start, tabSelection.end);
    if (ranges[from] && ranges[to]) {
      tabJsonTextarea.setSelectionRange(ranges[from][0], ranges[to][1]);
      scrollTabJsonToOffset(text, ranges[from][0]);
    }
  } else {
    tabJsonTextarea.setSelectionRange(0, 0);
  }
}

function applyTabJsonText(rawText) {
  if (playbackHandle) return;

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
    title: typeof parsed.title === 'string' ? parsed.title : tabData.title,
    timeSignature: typeof parsed.timeSignature === 'string' ? parsed.timeSignature : tabData.timeSignature,
    tempoEvents:
      Array.isArray(parsed.tempoEvents) && parsed.tempoEvents.length > 0 ? parsed.tempoEvents : tabData.tempoEvents,
    notes: parsed.notes,
  };
  tabHistory = pushHistory(tabHistory, nextTabData);
  tabData = tabHistory.present;
  syncTabLibrary();
  renderTabView();
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
  commitTab({ notes: toggleSlideAt(tabData.notes, pairIndex, state.tuning) });
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
  renderTabView();
});

tabRedoBtn.addEventListener('click', () => {
  tabHistory = redoHistory(tabHistory);
  tabData = tabHistory.present;
  tabSelection = null;
  syncTabLibrary();
  renderTabView();
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
  commitTab({ title: tabTitleInput.value.trim() || '曲名未設定' });
  renderTabView();
});

tabTempoInput.addEventListener('change', () => {
  const bpm = Math.min(300, Math.max(20, Number(tabTempoInput.value) || 120));
  commitTab({ tempoEvents: [{ atIndex: 0, bpm }] });
  renderTabView();
});

tabMetronomeBtn.addEventListener('click', () => {
  metronomeOn = !metronomeOn;
  tabMetronomeBtn.classList.toggle('active', metronomeOn);
  tabMetronomeBtn.setAttribute('aria-pressed', String(metronomeOn));
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
  if (playbackHandle) {
    stopTabPlayback();
    return;
  }
  if (tabData.notes.length === 0) return;

  // 選択範囲がある場合はその先頭位置から再生する
  const startIndex = tabSelection ? Math.min(tabSelection.start, tabSelection.end) : 0;

  playbackHandle = playTab(tabData, state.tuning, {
    metronome: metronomeOn,
    octaveUp: state.tabOctaveUp,
    startIndex,
    onNoteStart: (index) => {
      playingIndex = index;
      renderTabView();
    },
    onEnd: stopTabPlayback,
  });
  tabPlayBtn.textContent = '停止';
  syncTabJsonView();
});

// 画面上部の設定(セクション5でlocalStorageに保存している項目)のスナップショット
function settingsSnapshot() {
  return {
    tuning: state.tuning.map((s) => ({ ...s })),
    fretCount: state.fretCount,
    key: state.key,
    scale: state.scale,
    displayMode: state.displayMode,
    masterVolume: state.masterVolume,
    tabOctaveUp: state.tabOctaveUp,
    tabColorSync: state.tabColorSync,
  };
}

const SETTINGS_FIELD_LABELS = {
  tuning: 'チューニング',
  fretCount: 'フレット数',
  key: 'キー',
  scale: 'スケール',
  displayMode: '表示モード',
  masterVolume: '音量',
  tabOctaveUp: 'TABオクターブ上げ再生',
  tabColorSync: 'TABスケール配色連動',
};

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

// settingsの各項目を個別に検証し、有効な項目だけstateへ反映する。
// 項目が未指定なら何もしない(旧形式ファイル等)。値はあるが不正・非対応なら
// その項目だけスキップし、呼び出し側への通知用にラベルを返す
function applyImportedSettings(settings) {
  const skipped = [];

  if (settings.tuning !== undefined) {
    if (isValidImportedTuning(settings.tuning)) {
      state.tuning = settings.tuning.map((s) => ({ name: s.name, octave: s.octave }));
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.tuning);
    }
  }

  if (settings.fretCount !== undefined) {
    if (Number.isFinite(settings.fretCount)) {
      state.fretCount = clampFretCount(settings.fretCount);
    } else {
      skipped.push(SETTINGS_FIELD_LABELS.fretCount);
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
  a.download = `${tabData.title || 'tab'}.json`;
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

    tabData = { ...createTabData(), ...tabSource };
    tabHistory = createHistory(tabData);
    tabSelection = null;
    syncTabLibrary();

    if (parsed && typeof parsed === 'object' && parsed.settings && typeof parsed.settings === 'object') {
      const skipped = applyImportedSettings(parsed.settings);
      syncControlsFromState();
      renderStringList();
      saveSettings(state);
      if (skipped.length > 0) {
        showToast(`一部の設定を読み込めなかったため現在の設定を維持しました: ${skipped.join('、')}`);
      }
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

populateStaticSelects();
syncControlsFromState();
renderStringList();
populateDurationButtons();
syncGhostButton();
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
  state.tuning = preset.strings.map((s) => ({ ...s }));
  persistAndRender();
  renderStringList();
});

fretCountInput.addEventListener('change', () => {
  state.fretCount = clampFretCount(Number(fretCountInput.value) || 1);
  fretCountInput.value = state.fretCount;
  persistAndRender();
});

addStringBtn.addEventListener('click', () => {
  state.tuning = addString(state.tuning);
  presetSelect.value = CUSTOM_PRESET_VALUE;
  persistAndRender();
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
