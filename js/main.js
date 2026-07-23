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
  setDurationAt,
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

let tabLibrary = loadTabLibrary();
let tabData = tabLibrary.tabs[0];
let tabHistory = createHistory(tabData);
let tabSelection = null; // {start, end} (notesへのインデックス範囲、順不同)
let tabClipboard = null;
let selectedDuration = 'quarter';
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

  state.tuning.forEach((s, index) => {
    const row = document.createElement('div');
    row.className = 'string-row';

    const label = document.createElement('span');
    label.className = 'string-row-label';
    label.textContent = `弦${index + 1}`;

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
        if (tabSelection && tabSelection.start === tabSelection.end) {
          commitTab({ notes: setDurationAt(tabData.notes, tabSelection.start, d.id) });
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
    ? createGhostEntry({ string: stringIndex, fret, duration: selectedDuration })
    : createNoteEntry({ string: stringIndex, fret, duration: selectedDuration });

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

function handleTabColumnClick(index, event) {
  if (event.shiftKey && tabSelection) {
    tabSelection = { start: tabSelection.start, end: index };
  } else if (tabSelection && tabSelection.start === tabSelection.end && tabSelection.start === index) {
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
  const slideOk = isPair && canSlide(tabData.notes, pairIndex);

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
}

tabRestBtn.addEventListener('click', () => {
  const entry = createRestEntry(selectedDuration);
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
  commitTab({ notes: toggleSlideAt(tabData.notes, pairIndex) });
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

  playbackHandle = playTab(tabData, state.tuning, {
    metronome: metronomeOn,
    octaveUp: state.tabOctaveUp,
    onNoteStart: (index) => {
      playingIndex = index;
      renderTabView();
    },
    onEnd: stopTabPlayback,
  });
  tabPlayBtn.textContent = '停止';
});

tabExportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tabData, null, 2)], { type: 'application/json' });
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
    if (!parsed || !Array.isArray(parsed.notes)) throw new Error('invalid tab data');
    tabData = { ...createTabData(), ...parsed };
    tabHistory = createHistory(tabData);
    tabSelection = null;
    syncTabLibrary();
    renderTabView();
  } catch (e) {
    console.warn('TAB譜のインポートに失敗しました。', e);
    window.alert('TAB譜ファイルの読み込みに失敗しました。ファイル形式を確認してください。');
  } finally {
    tabImportInput.value = '';
  }
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
