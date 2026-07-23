// TAB譜のデータモデル定義・編集操作・Undo/Redo履歴管理

export const DURATION_BEATS = {
  whole: 4,
  half: 2,
  quarter: 1,
  '8th': 0.5,
  '16th': 0.25,
};

export const DURATION_LIST = [
  { id: 'whole', label: '全音符' },
  { id: 'half', label: '2分音符' },
  { id: 'quarter', label: '4分音符' },
  { id: '8th', label: '8分音符' },
  { id: '16th', label: '16分音符' },
];

const ARTICULATIONS = new Set(['tie', 'hammerOn', 'pullOff', 'slide']);
const HISTORY_LIMIT = 50;

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTabData(overrides = {}) {
  return {
    id: generateId(),
    title: '曲名未設定',
    timeSignature: '4/4',
    tempoEvents: [{ atIndex: 0, bpm: 120 }],
    notes: [],
    ...overrides,
  };
}

export function createTabLibrary() {
  return { tabs: [createTabData()] };
}

export function createNoteEntry({ string, fret, duration }) {
  return { type: 'note', string, fret, duration, articulation: null };
}

export function createRestEntry(duration) {
  return { type: 'rest', duration, articulation: null };
}

export function createGhostEntry({ string, fret, duration }) {
  return { type: 'ghost', string, fret, duration, articulation: null };
}

// notes配列のafterIndexの直後にentryを挿入する(afterIndexが-1なら先頭、undefinedなら末尾)
export function insertEntry(notes, entry, afterIndex) {
  const insertAt = afterIndex === undefined ? notes.length : afterIndex + 1;
  const copy = [...notes];
  copy.splice(insertAt, 0, entry);
  return copy;
}

export function insertEntries(notes, entries, afterIndex) {
  const insertAt = afterIndex === undefined ? notes.length : afterIndex + 1;
  const copy = [...notes];
  copy.splice(insertAt, 0, ...entries.map((e) => ({ ...e })));
  return copy;
}

export function removeRange(notes, startIndex, endIndex) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.filter((_, i) => i < from || i > to);
}

export function setDurationAt(notes, index, duration) {
  return notes.map((n, i) => (i === index ? { ...n, duration } : n));
}

function canLinkAsNotes(a, b) {
  return Boolean(a) && Boolean(b) && a.type === 'note' && b.type === 'note';
}

export function canTie(notes, index) {
  const a = notes[index];
  const b = notes[index + 1];
  return canLinkAsNotes(a, b) && a.string === b.string && a.fret === b.fret;
}

export function canHammerPull(notes, index) {
  const a = notes[index];
  const b = notes[index + 1];
  return canLinkAsNotes(a, b) && a.string === b.string && a.fret !== b.fret;
}

export function canSlide(notes, index) {
  return canHammerPull(notes, index);
}

export function toggleTieAt(notes, index) {
  if (!canTie(notes, index)) return notes;
  return notes.map((n, i) => (i === index ? { ...n, articulation: n.articulation === 'tie' ? null : 'tie' } : n));
}

export function toggleHammerPullAt(notes, index) {
  if (!canHammerPull(notes, index)) return notes;
  const type = notes[index + 1].fret > notes[index].fret ? 'hammerOn' : 'pullOff';
  return notes.map((n, i) =>
    i === index ? { ...n, articulation: n.articulation === type ? null : type } : n
  );
}

export function toggleSlideAt(notes, index) {
  if (!canSlide(notes, index)) return notes;
  return notes.map((n, i) => (i === index ? { ...n, articulation: n.articulation === 'slide' ? null : 'slide' } : n));
}

export function isArticulation(value) {
  return ARTICULATIONS.has(value);
}

export function cloneRange(notes, startIndex, endIndex) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.slice(from, to + 1).map((n) => ({ ...n }));
}

export function parseTimeSignature(sig) {
  const [beatsPerMeasure, beatUnit] = String(sig).split('/').map(Number);
  return {
    beatsPerMeasure: beatsPerMeasure > 0 ? beatsPerMeasure : 4,
    beatUnit: beatUnit > 0 ? beatUnit : 4,
  };
}

// 各notesインデックスの直前に小節線を描くべきかどうかを判定するためのSet(インデックス集合)を返す
export function computeMeasureBreaks(notes, timeSignature) {
  const { beatsPerMeasure } = parseTimeSignature(timeSignature);
  const breaks = new Set();
  let beatsInMeasure = 0;
  notes.forEach((note, i) => {
    if (i > 0 && beatsInMeasure >= beatsPerMeasure) {
      breaks.add(i);
      beatsInMeasure = 0;
    }
    beatsInMeasure += DURATION_BEATS[note.duration] ?? 1;
  });
  return breaks;
}

// --- Undo/Redo履歴(スナップショット方式) ---

export function createHistory(tabData) {
  return { past: [], present: cloneTabData(tabData), future: [] };
}

export function cloneTabData(tabData) {
  return JSON.parse(JSON.stringify(tabData));
}

export function pushHistory(history, nextTabData) {
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: cloneTabData(nextTabData), future: [] };
}

export function undoHistory(history) {
  if (history.past.length === 0) return history;
  const present = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  return { past, present, future: [history.present, ...history.future] };
}

export function redoHistory(history) {
  if (history.future.length === 0) return history;
  const present = history.future[0];
  const future = history.future.slice(1);
  return { past: [...history.past, history.present], present, future };
}
