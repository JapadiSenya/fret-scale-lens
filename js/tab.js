// TAB譜のデータモデル定義・編集操作・Undo/Redo履歴管理

import { toAbsoluteSemitone } from './notes.js';
import { TUNING_PRESETS, DEFAULT_FRET_COUNT } from './tuning.js';
import { normalizeEffects } from './effects.js';

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
    partName: 'パート未設定',
    tuning: TUNING_PRESETS[0].strings.map((s) => ({ ...s })),
    fretCount: DEFAULT_FRET_COUNT,
    effects: [],
    notes: [],
    ...overrides,
  };
}

export function createTabLibrary() {
  const tab = createTabData();
  return { activeTabId: tab.id, tabs: [tab] };
}

// tabLibraryへの新規TAB追加(activeTabIdは変更しない。切り替えは呼び出し側でsetActiveTabIdを使う)
export function addTabToLibrary(library, tabData) {
  return { ...library, tabs: [...library.tabs, tabData] };
}

// TAB削除。最低1つのTABは維持する(残り1つの場合は何もしない)。
// アクティブTABを削除した場合、削除位置に隣接するTABへ自動的に切り替える
export function removeTabFromLibrary(library, tabId) {
  if (library.tabs.length <= 1) return library;
  const index = library.tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return library;

  const tabs = library.tabs.filter((t) => t.id !== tabId);
  const activeTabId =
    library.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)].id : library.activeTabId;
  return { ...library, tabs, activeTabId };
}

export function setActiveTabId(library, tabId) {
  if (!library.tabs.some((t) => t.id === tabId)) return library;
  return { ...library, activeTabId: tabId };
}

// ghost: trueの場合、この弦はミュート/パーカッシブなヒット(✕表示)として扱う。
// 和音は複数ピッチを持てるため、通常のフレット音とゴースト(ミュート弦)を1つの和音内に混在させられる
export function createNoteEntry({ string, fret, duration, dotted = false, ghost = false, staccato = false }) {
  return {
    type: 'note',
    notes: [{ string, fret, ghost }],
    duration,
    dotted,
    staccato,
    bend: null,
    articulation: null,
    tuplet: null,
  };
}

export function createRestEntry(duration, dotted = false) {
  return { type: 'rest', duration, dotted, articulation: null, tuplet: null };
}

// 旧形式(string/fretをトップレベルに持つ単音エントリ、または"ghost"をエントリ全体の型として
// 持っていた形式)をnotes配列形式(ピッチごとにghostフラグを持つ)へ変換する後方互換処理
export function migrateEntry(entry) {
  if (!entry || (entry.type !== 'note' && entry.type !== 'ghost')) return entry;

  const wasGhostEntry = entry.type === 'ghost';
  const pitches = Array.isArray(entry.notes) ? entry.notes : [{ string: entry.string, fret: entry.fret }];

  return {
    type: 'note',
    notes: pitches.map((p) => ({ string: p.string, fret: p.fret, ghost: wasGhostEntry || Boolean(p.ghost) })),
    duration: entry.duration,
    dotted: entry.dotted,
    staccato: Boolean(entry.staccato), // staccatoを持たない旧形式は無効として扱う
    bend: BEND_SEMITONES.includes(entry.bend) ? entry.bend : null,
    articulation: entry.articulation,
    tuplet: entry.tuplet,
  };
}

// 旧形式(チューニング/フレット数を持たない、テンポ/拍子・曲名をTAB自身が持つ)からの後方互換処理。
// tuning/fretCountが無い場合はfallback(呼び出し側が把握している旧・画面設定など)、
// それも無ければアプリのデフォルトを採用する。旧フィールドのtempoEvents/timeSignatureは
// (グローバル設定側での採用は呼び出し側の責務とし)ここでは単純に取り除く。
// partNameが無くtitle(旧: 曲名)がある場合は、意味合いは変わるがテキストを失わないよう
// そのままpartNameとして採用する
export function migrateTabData(tabData, fallback = {}) {
  const tuning =
    Array.isArray(tabData.tuning) && tabData.tuning.length > 0
      ? tabData.tuning
      : Array.isArray(fallback.tuning) && fallback.tuning.length > 0
        ? fallback.tuning
        : TUNING_PRESETS[0].strings;
  const fretCount = Number.isFinite(tabData.fretCount)
    ? tabData.fretCount
    : Number.isFinite(fallback.fretCount)
      ? fallback.fretCount
      : DEFAULT_FRET_COUNT;
  const partName =
    typeof tabData.partName === 'string'
      ? tabData.partName
      : typeof tabData.title === 'string'
        ? tabData.title
        : 'パート未設定';

  const { tempoEvents, timeSignature, title, ...rest } = tabData;
  return {
    ...rest,
    partName,
    tuning: tuning.map((s) => ({ ...s })),
    fretCount,
    effects: normalizeEffects(tabData.effects), // effectsを持たない旧形式は空配列になる
    notes: (tabData.notes || []).map(migrateEntry),
  };
}

// 旧形式のtabDataが持っていたテンポ/拍子を取り出す(グローバル設定への採用可否は呼び出し側が判断する)
export function legacyTempoOf(tabData) {
  return Array.isArray(tabData?.tempoEvents) && tabData.tempoEvents.length > 0
    ? tabData.tempoEvents[0].bpm
    : null;
}

export function legacyTimeSignatureOf(tabData) {
  return typeof tabData?.timeSignature === 'string' ? tabData.timeSignature : null;
}

// 和音(複数弦同時押さえ)への音の追加・除去が可能なエントリかどうか
export function canAddPitch(entry) {
  return Boolean(entry) && entry.type === 'note';
}

// articulationは「このエントリから次のエントリへの連結」を表すため、ピッチ構成が変わったら
// 成立条件を満たすか再評価する。ハンマリング/プリングはフレットの上下で種別が決まるので、
// 差し替えで向きが逆転した場合はクリアせず種別を付け替える
function reevaluateArticulation(notes, index, tuning) {
  const entry = notes[index];
  if (!entry || !isArticulation(entry.articulation)) return entry;

  if (entry.articulation === 'tie') {
    return canTie(notes, index) ? entry : { ...entry, articulation: null };
  }
  if (entry.articulation === 'slide') {
    return canSlide(notes, index, tuning) ? entry : { ...entry, articulation: null };
  }
  if (!canHammerPull(notes, index)) return { ...entry, articulation: null };
  const type = notes[index + 1].notes[0].fret > entry.notes[0].fret ? 'hammerOn' : 'pullOff';
  return type === entry.articulation ? entry : { ...entry, articulation: type };
}

// notes配列のindex位置のエントリに(string, fret)を追加する。既に同じ弦が使われている場合、
// 同じフレットなら除去(最低1音は残す)、異なるフレットならその弦のフレットを差し替える
// (1本の弦は同時に1音までのため。貼り付けた和音の一音だけを直す・入力済みの音符のフレットを
// 修正する手段を兼ねる)。差し替えではゴースト属性は元のまま維持する
export function addPitchToEntry(notes, index, pitch, tuning) {
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
    nextPitches = entry.notes.map((p, pi) => (pi === existingIdx ? { ...p, fret: pitch.fret } : p));
  }

  const updated = notes.map((n, i) => (i === index ? { ...entry, notes: nextPitches } : n));
  // ピッチ構成が変わると、このエントリから次への連結と、直前のエントリからこのエントリへの
  // 連結の双方が成立しなくなることがあるため、両方を再評価する
  return updated.map((n, i) =>
    i === index - 1 || i === index ? reevaluateArticulation(updated, i, tuning) : n
  );
}

// 既存の複数音符を1つの和音エントリへ統合できるか。条件: 2音符以上・全てtype: "note"・
// duration/dottedが全て同じ・連符化されていない・(結合後に)同じ弦が重複しないこと
// (異なるフレット/長さの音符をどう1つに畳み込むべきか一意に定まらないため、揃っている場合のみ許可する)。
// ghost(ミュート)/通常のフレット音はいずれもnotes内のピッチごとの属性なので、混在していても統合できる
export function canMergeChord(notes, startIndex, endIndex) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  if (to - from < 1) return false;
  const range = notes.slice(from, to + 1);
  if (range.some((n) => !n || n.type !== 'note')) return false;

  const first = range[0];
  const sameShape = range.every((n) => n.duration === first.duration && n.dotted === first.dotted && !n.tuplet);
  if (!sameShape) return false;

  const strings = range.flatMap((n) => n.notes.map((p) => p.string));
  return new Set(strings).size === strings.length;
}

// 選択範囲の音符を1つの和音エントリへ統合する(各エントリのnotesを結合し、選択範囲先頭の位置に配置する)。
// 直前のエントリからこの位置へのarticulationは和音の連結先になれないため無効化する
export function mergeToChord(notes, startIndex, endIndex) {
  if (!canMergeChord(notes, startIndex, endIndex)) return notes;
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const range = notes.slice(from, to + 1);

  const mergedPitches = range.flatMap((n) => n.notes.map((p) => ({ ...p })));
  const mergedEntry = { ...range[0], notes: mergedPitches, articulation: null };

  const result = [...notes.slice(0, from), mergedEntry, ...notes.slice(to + 1)];
  const prevIndex = from - 1;
  if (prevIndex >= 0 && isArticulation(result[prevIndex].articulation)) {
    result[prevIndex] = { ...result[prevIndex], articulation: null };
  }
  return result;
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

// notes[0..index)の拍数の合計(=indexの音符が開始する時点の、先頭からの累積拍数)
export function beatsBeforeIndex(notes, index) {
  let beats = 0;
  for (let i = 0; i < index && i < notes.length; i++) {
    beats += getEntryBeats(notes[i]);
  }
  return beats;
}

// targetBeats(先頭からの累積拍数)の時点で鳴っている(または鳴り始める)音符のインデックスを返す。
// targetBeatsが末尾を超えている場合はnotes.length(=再生対象が無い)を返す。
// 複数TABの同時再生において、リズムが異なるTAB同士でも拍数を基準に開始位置を揃えるために使う
export function indexAtBeats(notes, targetBeats) {
  let beats = 0;
  for (let i = 0; i < notes.length; i++) {
    if (beats >= targetBeats - 1e-9) return i;
    beats += getEntryBeats(notes[i]);
  }
  return notes.length;
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

// チョーキングの上げ幅(半音単位)。ギターの記譜に合わせ、1/4音・半音・全音の3種類を扱う
export const BEND_OPTIONS = [
  { semitones: 0.5, label: '1/4', mark: 'b¼' },
  { semitones: 1, label: '半音', mark: 'b½' },
  { semitones: 2, label: '全音', mark: 'b1' },
];
const BEND_SEMITONES = BEND_OPTIONS.map((o) => o.semitones);

export function bendMarkOf(entry) {
  return BEND_OPTIONS.find((o) => o.semitones === entry?.bend)?.mark ?? '';
}

// チョーキングは音程を持たない休符には意味を持たないため、選択範囲のうち音符にのみ適用する
export function setBendRange(notes, startIndex, endIndex, bend) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.map((n, i) => (i >= from && i <= to && n.type === 'note' ? { ...n, bend } : n));
}

// スタッカートは発音しない休符には意味を持たないため、選択範囲のうち音符にのみ適用する
export function setStaccatoRange(notes, startIndex, endIndex, staccato) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return notes.map((n, i) => (i >= from && i <= to && n.type === 'note' ? { ...n, staccato } : n));
}

// 選択範囲にスタッカートを適用できるか(音符が1つも無ければ適用先が無い)
export function canStaccato(notes, startIndex, endIndex) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const range = notes.slice(from, to + 1);
  return range.length > 0 && range.some((n) => n && n.type === 'note');
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
// 和音・ゴースト(ミュート)音はこれらの連結先/連結元になれない
function canLinkAsNotes(a, b) {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a.type === 'note' &&
    b.type === 'note' &&
    a.notes.length === 1 &&
    b.notes.length === 1 &&
    !a.notes[0].ghost &&
    !b.notes[0].ghost
  );
}

// 2つのエントリが全く同じ(弦, フレット, ゴースト有無)の組み合わせで構成されているか(配列の並び順は問わない)。
// 単音同士(notes.length === 1)なら「同じ弦・同じフレット・同じゴースト状態」の判定と同義、
// 和音同士なら同一voicingの判定になる。ゴーストを含む音符・和音同士でも、構成が完全一致していれば
// タイ可能(ゴーストは「1回だけ短く鳴らして残りは沈黙する」という形でタイの意味を持つため)
function sameVoicing(a, b) {
  if (a.notes.length !== b.notes.length) return false;
  const key = (p) => `${p.string}:${p.fret}:${p.ghost ? 1 : 0}`;
  const bKeys = new Set(b.notes.map(key));
  return a.notes.every((p) => bKeys.has(key(p)));
}

// タイは単音同士だけでなく、同一voicingの和音同士にも成立する(ゴーストを含む場合は不可)
export function canTie(notes, index) {
  const a = notes[index];
  const b = notes[index + 1];
  if (!a || !b || a.type !== 'note' || b.type !== 'note') return false;
  return sameVoicing(a, b);
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

// 選択範囲の全ピッチのフレットをdelta分だけ動かせるか。1つでもフレット範囲(0〜fretCount)を
// 外れるなら不可とする(一部のピッチだけ動かすと和音の構成が崩れるため、範囲全体で可否を判定する)
export function canTranspose(notes, startIndex, endIndex, delta, fretCount) {
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const range = notes.slice(from, to + 1);
  if (range.length === 0 || range.some((n) => !n)) return false;
  const pitches = range.filter((n) => n.type === 'note').flatMap((n) => n.notes);
  if (pitches.length === 0) return false; // 全て休符の選択には適用できない
  return pitches.every((p) => p.fret + delta >= 0 && p.fret + delta <= fretCount);
}

// 選択範囲の音符のフレットをdelta分だけ動かす(1フレット=半音)。和音は全ピッチを同じだけ
// 動かしてvoicingを保ったまま平行移動する。休符はそのまま残す
export function transposeRange(notes, startIndex, endIndex, delta, fretCount, tuning) {
  if (!canTranspose(notes, startIndex, endIndex, delta, fretCount)) return notes;
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

  const moved = notes.map((n, i) =>
    i >= from && i <= to && n.type === 'note'
      ? { ...n, notes: n.notes.map((p) => ({ ...p, fret: p.fret + delta })) }
      : n
  );
  // 範囲の直前のエントリから範囲先頭への連結と、範囲内の各連結は、ピッチが変わることで
  // 成立しなくなることがあるため再評価する(範囲全体を同じだけ動かした場合は維持される)
  return moved.map((n, i) => (i >= from - 1 && i <= to ? reevaluateArticulation(moved, i, tuning) : n));
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
