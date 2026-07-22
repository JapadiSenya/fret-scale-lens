// スケール定義とスケール判定ロジック

// メジャースケールの各度数における機能和声(トニック/サブドミナント/ドミナント)
const MAJOR_DEGREES = {
  0: { roman: 'I', func: 'T' },
  2: { roman: 'ii', func: 'S' },
  4: { roman: 'iii', func: 'T' },
  5: { roman: 'IV', func: 'S' },
  7: { roman: 'V', func: 'D' },
  9: { roman: 'vi', func: 'T' },
  11: { roman: 'vii°', func: 'D' },
};

// ナチュラルマイナースケールの各度数における機能和声
const MINOR_DEGREES = {
  0: { roman: 'i', func: 'T' },
  2: { roman: 'ii°', func: 'S' },
  3: { roman: 'III', func: 'T' },
  5: { roman: 'iv', func: 'S' },
  7: { roman: 'v', func: 'D' },
  8: { roman: 'VI', func: 'T' },
  10: { roman: 'VII', func: 'D' },
};

// ブルーノート(♭5)はT/S/Dいずれの機能にも属さない
const BLUE_NOTE_DEGREE = { roman: '♭V', func: null };

function pickDegrees(source, semitones) {
  const result = {};
  semitones.forEach((s) => {
    result[s] = source[s];
  });
  return result;
}

export const SCALES = {
  major: {
    id: 'major',
    label: 'メジャー',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    degreeMap: MAJOR_DEGREES,
  },
  naturalMinor: {
    id: 'naturalMinor',
    label: 'ナチュラルマイナー',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    degreeMap: MINOR_DEGREES,
  },
  majorPentatonic: {
    id: 'majorPentatonic',
    label: 'メジャーペンタトニック',
    intervals: [0, 2, 4, 7, 9],
    degreeMap: pickDegrees(MAJOR_DEGREES, [0, 2, 4, 7, 9]),
  },
  minorPentatonic: {
    id: 'minorPentatonic',
    label: 'マイナーペンタトニック',
    intervals: [0, 3, 5, 7, 10],
    degreeMap: pickDegrees(MINOR_DEGREES, [0, 3, 5, 7, 10]),
  },
  blues: {
    id: 'blues',
    label: 'ブルーススケール',
    intervals: [0, 3, 5, 6, 7, 10],
    degreeMap: { ...pickDegrees(MINOR_DEGREES, [0, 3, 5, 7, 10]), 6: BLUE_NOTE_DEGREE },
  },
};

export const SCALE_LIST = Object.values(SCALES);

export const FUNCTION_LABELS = {
  T: 'トニック',
  S: 'サブドミナント',
  D: 'ドミナント',
};

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

// 度数(ローマ数字)と機能和声グループ(T/S/D、非該当はnull)を返す。スケールに含まれない度数はnull
export function getDegreeInfo(noteIndex, rootIndex, scaleId) {
  const scale = getScale(scaleId);
  return scale.degreeMap[scaleDegree(noteIndex, rootIndex)] ?? null;
}
