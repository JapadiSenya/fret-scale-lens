// 弦数・チューニング状態管理とプリセット定義
// 楽器種別という概念は持たず、「弦数+チューニング」のプリセットとして扱う

export const DEFAULT_FRET_COUNT = 24;
export const MIN_STRINGS = 1;
export const MAX_STRINGS = 8;
export const MIN_FRETS = 1;
export const MAX_FRETS = 36;

// strings配列は低音弦から高音弦の順で保持する
export const TUNING_PRESETS = [
  {
    id: 'bass4',
    label: 'ベース4弦(標準)',
    strings: [
      { name: 'E', octave: 1 },
      { name: 'A', octave: 1 },
      { name: 'D', octave: 2 },
      { name: 'G', octave: 2 },
    ],
  },
  {
    id: 'bass5',
    label: 'ベース5弦',
    strings: [
      { name: 'B', octave: 0 },
      { name: 'E', octave: 1 },
      { name: 'A', octave: 1 },
      { name: 'D', octave: 2 },
      { name: 'G', octave: 2 },
    ],
  },
  {
    id: 'guitar6',
    label: 'ギター6弦(標準)',
    strings: [
      { name: 'E', octave: 2 },
      { name: 'A', octave: 2 },
      { name: 'D', octave: 3 },
      { name: 'G', octave: 3 },
      { name: 'B', octave: 3 },
      { name: 'E', octave: 4 },
    ],
  },
];

export function findPreset(id) {
  return TUNING_PRESETS.find((p) => p.id === id);
}

export function clampFretCount(count) {
  return Math.min(MAX_FRETS, Math.max(MIN_FRETS, Math.round(count)));
}

export function addString(strings, note = { name: 'C', octave: 3 }) {
  if (strings.length >= MAX_STRINGS) return strings;
  return [...strings, { ...note }];
}

export function removeString(strings, index) {
  if (strings.length <= MIN_STRINGS) return strings;
  return strings.filter((_, i) => i !== index);
}

export function updateString(strings, index, changes) {
  return strings.map((s, i) => (i === index ? { ...s, ...changes } : s));
}
