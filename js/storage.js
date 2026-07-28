// localStorageへの設定の読み書き

import { createTabLibrary, migrateTabData, legacyTempoOf, legacyTimeSignatureOf } from './tab.js';

const STORAGE_KEY = 'fretScaleLens.settings';
const TAB_STORAGE_KEY = 'fretScaleLens.tabLibrary';

export function defaultSettings() {
  return {
    songTitle: '曲名未設定',
    key: 'C',
    scale: 'major',
    displayMode: 'scale',
    masterVolume: 0.8,
    tempo: 120,
    timeSignature: '4/4',
    tabOctaveUp: false,
    tabColorSync: false,
    tabMetronome: false,
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

// fallback: 旧形式(画面側にチューニング/フレット数を持っていた頃)からの移行時、
// tuning/fretCountを持たないTABに適用する既定値({tuning, fretCount})
export function loadTabLibrary(fallback = {}) {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (!raw) return createTabLibrary();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return createTabLibrary();
    const tabs = parsed.tabs.map((t) => migrateTabData(t, fallback));
    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0].id;
    return { activeTabId, tabs };
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

// 旧形式(TABごとにtempoEvents/timeSignatureを持っていた頃)のデータが残っていれば、
// 保存されたテンポ/拍子を(グローバル設定への採用要否の判断は呼び出し側に委ねつつ)取り出す。
// 読み込みのみで状態は変更しない
export function peekLegacyTempoAndTimeSignature() {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs)) return {};
    const tempoSource = parsed.tabs.find((t) => legacyTempoOf(t) != null);
    const timeSignatureSource = parsed.tabs.find((t) => legacyTimeSignatureOf(t) != null);
    return {
      tempo: tempoSource ? legacyTempoOf(tempoSource) : undefined,
      timeSignature: timeSignatureSource ? legacyTimeSignatureOf(timeSignatureSource) : undefined,
    };
  } catch (e) {
    return {};
  }
}
