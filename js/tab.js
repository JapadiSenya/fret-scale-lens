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
  return { type: 'note', notes: [{ string, fret }], duration, dotted, articulation: null, tuplet: null };
}

export function createRestEntry(duration, dotted = false) {
  return { type: 'rest', duration, dotted, articulation: null, tuplet: null };
}

export function createGhostEntry({ string, fret, duration, dotted = false }) {
  return { type: 'ghost', notes: [{ string, fret }], duration, dotted, articulation: null, tuplet: null };
}

// 旧形式(string/fretをトップレベルに持つ単音エントリ)をnotes配列形式へ変換する後方互換処理
export function migrateEntry(entry) {
  if (!entry) return entry;
  if ((entry.type === 'note' || entry.type === 'ghost') && !Array.isArray(entry.notes)) {
    const { type, string, fret, duration, dotted, articulation, tuplet } = entry;
    return { type, notes: [{ string, fret }], duration, dotted, articulation, tuplet };
  }
  return entry;
}

export function migrateTabData(tabData) {
  return { ...tabData, notes: (tabData.notes || []).map(migrateEntry) };
}

// 和音(複数弦同時押さえ)への音の追加・除去が可能なエントリかどうか
export function canAddPitch(entry) {
  return Boolean(entry) && (entry.type === 'note' || entry.type === 'ghost');
}

// notes配列のindex位置のエントリに(string, fret)を追加する。
// 既に同じ弦が使われている場合、同じフレットなら除去(最低1音は残す)、異なるフレットなら何もしない
// (1本の弦は同時に1音までのため)。単音→和音への遷移が発生した場合、そのエントリと
// 直前のエントリからこのエントリへ向かうarticulationを無効化する(和音は連結先になれないため)
export function addPitchToEntry(notes, index, pitch) {
  const entry = notes[index];
  if (!canAddPitch(entry)) return notes;

  const existingIdx = entry.notes.findIndex((p) => p.string === pitch.string);
  let nextPitches;
  if (existingIdx === -1) {
    nextPitches = [...entry.notes, pitch];
  } else if (entry.notes[existingIdx].fret === pitch.fret) {
    if (entry.notes.length === 1) return notes;
    nextPitches = entry.notes.filter((_, pi) => pi !== existingIdx);
  } else {
    return notes;
  }

  const becameChord = entry.notes.length === 1 && nextPitches.length > 1;
  return notes.map((n, i) => {
    if (becameChord && i === index - 1 && isArticulation(n.articulation)) {
      return { ...n, articulation: null };
    }
    if (i === index) {
      return { ...n, notes: nextPitches, articulation: nextPitches.length > 1 ? null : n.articulation };
    }
    return n;
  });
}

// 付点を考慮した「見た目上の」拍数(連符でない場合はこれがそのまま実際の拍数になる)
function notatedBeats(entry) {
  const base = DURATION_BEATS[entry.duration] ?? 1;
  return entry.dotted ? base * 1.5 : base;
}

// 連符を考慮した実際の拍数。n連符はnotatedBeatsの半分の音価をn個使ってnotatedBeats×2の長さに詰め込む
// (例: 8分音符3連符なら、8分音符notatedBeats=0.5の2倍=四分音符1拍分を3等分する)
export function getEntryBeats(entry) {
  const beats = notatedBeats(entry);
  return entry.tuplet ? (beats * 2) / entry.tuplet : beats;
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

// 連符化: 選択範囲(2音符以上、durationが全て同じ)が対象。nは選択範囲の音符数をそのまま使う
export function canTuplet(notes, startIndex, endIndex) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  if (to - from < 1) return false;
  const range = notes.slice(from, to + 1);
  if (range.some((n) => !n)) return false;
  return range.every((n) => n.duration === range[0].duration);
}

// 選択範囲が既に(範囲サイズ=n個の)連符であれば解除、そうでなければ選択範囲のサイズをnとして連符化する
export function toggleTupletAt(notes, startIndex, endIndex) {
  if (!canTuplet(notes, startIndex, endIndex)) return notes;
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const size = to - from + 1;
  const alreadyTupleted = notes.slice(from, to + 1).every((n) => n.tuplet === size);
  const nextTuplet = alreadyTupleted ? null : size;
  return notes.map((n, i) => (i >= from && i <= to ? { ...n, tuplet: nextTuplet } : n));
}

// notes配列を連符グループごとにまとめる。同じn値が連続するランをn個ずつのまとまりとみなし、
// 編集(削除等)でn個に満たなくなった不完全なグループはcomplete:falseとして返す
// (小節長不一致警告と同様、エラー扱いにはせず表示側で軽く警告する想定)
export function computeTupletGroups(notes) {
  const groups = [];
  let current = null;
  notes.forEach((entry, i) => {
    const n = entry.tuplet;
    if (!n) {
      current = null;
      return;
    }
    if (!current || current.n !== n || current.count >= current.n) {
      current = { startIndex: i, endIndex: i, n, count: 0 };
      groups.push(current);
    }
    current.endIndex = i;
    current.count += 1;
  });
  return groups.map(({ startIndex, endIndex, n, count }) => ({
    startIndex,
    endIndex,
    n,
    complete: count === n,
  }));
}

// タイ/ハンマリング・プリング/スライドは単音同士(notes.length === 1)の連結にのみ成立する。
// 和音はこれらの連結先/連結元になれない
function canLinkAsNotes(a, b) {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a.type === 'note' &&
    b.type === 'note' &&
    a.notes.length === 1 &&
    b.notes.length === 1
  );
}

export function canTie(notes, index) {
  const a = notes[index];
  const b = notes[index + 1];
  return canLinkAsNotes(a, b) && a.notes[0].string === b.notes[0].string && a.notes[0].fret === b.notes[0].fret;
}

export function canHammerPull(notes, index) {
  const a = notes[index];
  const b = notes[index + 1];
  return canLinkAsNotes(a, b) && a.notes[0].string === b.notes[0].string && a.notes[0].fret !== b.notes[0].fret;
}

// スライドは異弦間でも成立するため、フレットではなく実際のピッチ(オープン弦音+フレット)で判定する
function pitchAtEntry(tuning, entry) {
  const pitch = entry.notes?.[0];
  const openString = pitch && tuning?.[pitch.string];
  if (!openString) return null;
  return toAbsoluteSemitone(openString.name, openString.octave) + pitch.fret;
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
  const type = notes[index + 1].notes[0].fret > notes[index].notes[0].fret ? 'hammerOn' : 'pullOff';
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
