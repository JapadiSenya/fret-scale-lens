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
import { loadSettings, saveSettings } from './storage.js';
import { playFrequency, setMasterVolume } from './audio.js';
import { renderFretboard } from './render.js';

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
    onNoteClick: (_stringIndex, _fret, note) => {
      playFrequency(frequencyOf(note.name, note.octave));
    },
  });
  renderLegend();
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
