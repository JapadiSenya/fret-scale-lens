// localStorageへの設定の読み書き

import { TUNING_PRESETS, DEFAULT_FRET_COUNT } from './tuning.js';

const STORAGE_KEY = 'fretScaleLens.settings';

export function defaultSettings() {
  return {
    tuning: TUNING_PRESETS[0].strings.map((s) => ({ ...s })),
    fretCount: DEFAULT_FRET_COUNT,
    key: 'C',
    scale: 'major',
    displayMode: 'scale',
    masterVolume: 0.8,
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    return { ...defaultSettings(), ...parsed };
  } catch (e) {
    console.warn('設定の読み込みに失敗しました。デフォルト設定を使用します。', e);
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('設定の保存に失敗しました。', e);
  }
}
