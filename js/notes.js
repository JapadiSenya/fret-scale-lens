// 音名・オクターブ・周波数の計算を扱う純粋関数群

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteNameToIndex(name) {
  const index = NOTE_NAMES.indexOf(name);
  if (index === -1) throw new Error(`Unknown note name: ${name}`);
  return index;
}

// オクターブ跨ぎの計算を扱いやすくするため、C0を基準とした絶対半音番号に変換する
export function toAbsoluteSemitone(name, octave) {
  return octave * 12 + noteNameToIndex(name);
}

export function fromAbsoluteSemitone(absoluteSemitone) {
  const noteIndex = ((absoluteSemitone % 12) + 12) % 12;
  const octave = Math.floor(absoluteSemitone / 12);
  return { name: NOTE_NAMES[noteIndex], octave };
}

const A4_ABSOLUTE_SEMITONE = toAbsoluteSemitone('A', 4);

// A4=440Hzを基準とした周波数計算
export function frequencyFromAbsoluteSemitone(absoluteSemitone) {
  return 440 * Math.pow(2, (absoluteSemitone - A4_ABSOLUTE_SEMITONE) / 12);
}

export function frequencyOf(name, octave) {
  return frequencyFromAbsoluteSemitone(toAbsoluteSemitone(name, octave));
}

// 開放弦の音名+オクターブから、指定フレット分の半音を加算した音を求める
export function noteAtFret(openName, openOctave, fret) {
  return fromAbsoluteSemitone(toAbsoluteSemitone(openName, openOctave) + fret);
}
