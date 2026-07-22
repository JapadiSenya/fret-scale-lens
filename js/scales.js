// スケール定義とスケール判定ロジック

export const SCALES = {
  major: { id: 'major', label: 'メジャー', intervals: [0, 2, 4, 5, 7, 9, 11] },
  naturalMinor: { id: 'naturalMinor', label: 'ナチュラルマイナー', intervals: [0, 2, 3, 5, 7, 8, 10] },
  majorPentatonic: { id: 'majorPentatonic', label: 'メジャーペンタトニック', intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { id: 'minorPentatonic', label: 'マイナーペンタトニック', intervals: [0, 3, 5, 7, 10] },
  blues: { id: 'blues', label: 'ブルーススケール', intervals: [0, 3, 5, 6, 7, 10] },
};

export const SCALE_LIST = Object.values(SCALES);

export function getScale(scaleId) {
  return SCALES[scaleId] ?? SCALES.major;
}

// ルート音からの相対半音数(0〜11)を求める
export function scaleDegree(noteIndex, rootIndex) {
  return ((noteIndex - rootIndex) % 12 + 12) % 12;
}

export function isRootNote(noteIndex, rootIndex) {
  return scaleDegree(noteIndex, rootIndex) === 0;
}

export function isInScale(noteIndex, rootIndex, scaleId) {
  const scale = getScale(scaleId);
  return scale.intervals.includes(scaleDegree(noteIndex, rootIndex));
}
