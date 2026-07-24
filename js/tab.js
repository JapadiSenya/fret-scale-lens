// TAB譜のデータモデル定義・編集操作・Undo/Redo履歴管理

import { toAbsoluteSemitone } from './notes.js';

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

export function createNoteEntry({ string, fret, duration, dotted = false }) {
  return { type: 'note', string, fret, duration, dotted, articulation: null };
}

export function createRestEntry(duration, dotted = false) {
  return { type: 'rest', duration, dotted, articulation: null };
}

export function createGhostEntry({ string, fret, duration, dotted = false }) {
  return { type: 'ghost', string, fret, duration, dotted, articulation: null };
}

// 付点を考慮した実際の拍数
export function getEntryBeats(entry) {
  const base = DURATION_BEATS[entry.duration] ?? 1;
  return entry.dotted ? base * 1.5 : base;
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

// 選択範囲(単一音符の場合も含む)の音符長を一括変更する
export function setDurationRange(notes, startIndex, endIndex, duration) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.map((n, i) => (i >= from && i <= to ? { ...n, duration } : n));
}

// 選択範囲(単一音符の場合も含む)の付点有無を一括変更する
export function setDottedRange(notes, startIndex, endIndex, dotted) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.map((n, i) => (i >= from && i <= to ? { ...n, dotted } : n));
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

// スライドは異弦間でも成立するため、フレットではなく実際のピッチ(オープン弦音+フレット)で判定する
function pitchAtEntry(tuning, entry) {
  const openString = tuning?.[entry.string];
  if (!openString) return null;
  return toAbsoluteSemitone(openString.name, openString.octave) + entry.fret;
}

export function canSlide(notes, index, tuning) {
  const a = notes[index];
  const b = notes[index + 1];
  if (!canLinkAsNotes(a, b)) return false;
  const pitchA = pitchAtEntry(tuning, a);
  const pitchB = pitchAtEntry(tuning, b);
  return pitchA != null && pitchB != null && pitchA !== pitchB;
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

export function toggleSlideAt(notes, index, tuning) {
  if (!canSlide(notes, index, tuning)) return notes;
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

// notes配列を小節ごとにグルーピングし、小節番号・拍数合計・timeSignatureとの整合性を計算する
export function computeMeasures(notes, timeSignature) {
  const { beatsPerMeasure } = parseTimeSignature(timeSignature);
  if (notes.length === 0) return [];

  const measures = [];
  let current = { startIndex: 0, totalBeats: 0 };
  notes.forEach((note, i) => {
    if (i > 0 && current.totalBeats >= beatsPerMeasure) {
      measures.push({ ...current, endIndex: i - 1 });
      current = { startIndex: i, totalBeats: 0 };
    }
    current.totalBeats += getEntryBeats(note);
  });
  measures.push({ ...current, endIndex: notes.length - 1 });

  return measures.map((m, i) => ({
    ...m,
    measureNumber: i + 1,
    valid: Math.abs(m.totalBeats - beatsPerMeasure) < 1e-9,
  }));
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
