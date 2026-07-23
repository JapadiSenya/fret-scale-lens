// localStorageへの設定の読み書き

import { TUNING_PRESETS, DEFAULT_FRET_COUNT } from './tuning.js';
import { createTabLibrary } from './tab.js';

const STORAGE_KEY = 'fretScaleLens.settings';
const TAB_STORAGE_KEY = 'fretScaleLens.tabLibrary';

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

export function loadTabLibrary() {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (!raw) return createTabLibrary();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return createTabLibrary();
    return parsed;
  } catch (e) {
    console.warn('TAB譜の読み込みに失敗しました。新規データを使用します。', e);
    return createTabLibrary();
  }
}

export function saveTabLibrary(tabLibrary) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabLibrary));
  } catch (e) {
    console.warn('TAB譜の保存に失敗しました。', e);
  }
}
