// TAB譜の再生(tempoEvents・durationから実時間へ変換して順次再生)とメトロノーム

import { noteAtFret, frequencyOf } from './notes.js';
import { getAudioContext, getMasterGain } from './audio.js';
import { getPluckBuffer } from './pluck.js';
import { getEntryBeats, parseTimeSignature } from './tab.js';

const LOOKAHEAD_PAD = 0.05;
// 先読みスケジューリングの窓。バックグラウンドタブではsetIntervalが1秒程度まで間引かれるため、
// それを吸収できる長さを取る(音声再生中のタブはそれ以上の間引き対象からは外れる)
const SCHEDULE_AHEAD_SECONDS = 2.5;
const SCHEDULER_INTERVAL_MS = 400;
// 1エントリあたりのスケジューリング所要時間の目安(実測でおよそ0.07ms/エントリ)。音符数の多い
// 譜面では`OscillatorNode`の生成だけで100ms以上かかるため、その分を見越して開始時刻に余裕を
// 持たせないと、予約し終える前に開始時刻を過ぎてしまい冒頭の音が詰まって鳴る
const SCHEDULING_SECONDS_PER_ENTRY = 0.0001;
const MAX_LOOKAHEAD_PAD = 0.4;

/**
 * 同時再生する全トラックで共有する再生開始時刻(AudioContextの時刻)を返す。
 * トラックごとに`playTab`の中で`ctx.currentTime`を読むと、先に予約したトラックの
 * スケジューリングに要した時間だけ後続のトラックが遅れて鳴り出してしまうため、
 * セッション全体で1つの基準時刻を共有する
 * @param {number} totalEntries セッション全体で予約する音符・休符の総数
 */
export function playbackStartTime(totalEntries = 0) {
  const pad = Math.min(LOOKAHEAD_PAD + totalEntries * SCHEDULING_SECONDS_PER_ENTRY, MAX_LOOKAHEAD_PAD);
  return getAudioContext().currentTime + pad;
}

const ATTACK_SECONDS = 0.002;
const RELEASE_SECONDS = 0.12;
// スタッカートは音符長(リズム上の位置)を変えずに発音の長さだけを切る。余韻も短くして明確に切る
const STACCATO_RATIO = 0.5;
const STACCATO_RELEASE_SECONDS = 0.04;
const VOICE_PEAK_GAIN = 0.32;
// ブラッシング音はノイズ主体でピーク比のエネルギーが小さいため、同じ体感音量にするには
// 通常の発音よりピークを高く取る必要がある(実効的な音量は通常音の1/4程度になる)
const GHOST_PEAK_GAIN = 0.35;

// 音の減衰はKarplus-Strongの波形自体に含まれているため、ここでは発音時のクリック防止と、
// 音符の終わりの余韻だけを担う。撥弦楽器は弾いた瞬間から減衰し続けるのでサステインの平坦部は設けない。
// 余韻は音符の長さの内側を削るのではなく、音符の終わりから先へ伸ばす。内側を削ると、8分・16分の
// ような短い音符では「アタックだけ鳴らして即座に消える」形になり、硬い音が連続してしまうため。
// 余韻の長さは音符の長さで頭打ちにして、速いパッセージが濁らないようにする
function scheduleEnvelope(gain, startTime, duration, { peak = VOICE_PEAK_GAIN, release = RELEASE_SECONDS } = {}) {
  const attackEnd = startTime + Math.min(ATTACK_SECONDS, duration);
  const noteEnd = startTime + duration;
  const releaseEnd = noteEnd + Math.max(Math.min(release, duration), 0.01);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.setValueAtTime(peak, noteEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

  return releaseEnd;
}

function frequencyForPitch(tuning, pitch, octaveUp) {
  const openString = pitch ? tuning[pitch.string] : null;
  if (!openString) return null;
  const note = noteAtFret(openString.name, openString.octave, pitch.fret);
  const freq = frequencyOf(note.name, note.octave);
  return octaveUp ? freq * 2 : freq;
}

// 1本のOscillatorNodeが追いかけるピッチを、グループ内の各エントリから取り出す。
// タイで連結された和音は配列の並び順ではなく弦番号で対応を取る必要がある一方、
// スライドは弦をまたいで連結できる(単音同士のみ)ため、弦番号が一致しない場合は
// そのエントリの唯一のピッチをそのまま使う
function pitchOnString(entry, stringNum) {
  const onString = entry.notes.find((p) => p.string === stringNum);
  if (onString) return onString;
  return entry.notes.length === 1 ? entry.notes[0] : undefined;
}

// 同じ(弦, フレット, ゴースト有無)の組み合わせを持つ和音同士か(tab.jsのcanTie判定と同じ条件を
// 再生スケジューリング側でも確認する)
function sameVoicingForTie(a, b) {
  if (a.notes.length !== b.notes.length) return false;
  const key = (p) => `${p.string}:${p.fret}:${p.ghost ? 1 : 0}`;
  const bKeys = new Set(b.notes.map(key));
  return a.notes.every((p) => bKeys.has(key(p)));
}

// タイ/ハンマリング/プリング/スライドで連結された連続音符を1つの発音グループにまとめる。
// ハンマリング・プリング/スライドは単音(notes.length===1・非ゴースト)同士でのみ連結できる。
// タイは単音・和音を問わず、ゴーストを含んでいても構成が完全一致していれば連結できる
// (ゴーストピッチはgroup.items[0]の情報のみで1回だけ短く発音するため、連結後も正しく振る舞う)
function groupEntries(notes) {
  const groups = [];
  notes.forEach((entry, i) => {
    const prev = notes[i - 1];
    let linkedToPrev = false;
    if (prev && prev.type === 'note' && entry.type === 'note') {
      if (prev.articulation === 'tie') {
        linkedToPrev = sameVoicingForTie(prev, entry);
      } else if (['hammerOn', 'pullOff', 'slide'].includes(prev.articulation || '')) {
        linkedToPrev =
          prev.notes.length === 1 && entry.notes.length === 1 && !prev.notes[0].ghost && !entry.notes[0].ghost;
      }
    }
    if (linkedToPrev) {
      groups[groups.length - 1].items.push(entry);
    } else {
      groups.push({ startIndex: i, items: [entry] });
    }
  });
  return groups;
}

// グループが実際に発音する長さ(秒)。スタッカートはリズム上の長さを変えずに発音だけを切るため、
// ここでのみ短くする。タイ等で連結されたグループでは、最後の音符に付いている場合だけ効く
// (途中の音符は次の音符へ続くため、そこで切ると連結の意味が失われる)
function soundSeconds(group, secondsPerBeat) {
  const beats = group.items.reduce((sum, item, i) => {
    const isLast = i === group.items.length - 1;
    return sum + getEntryBeats(item) * (isLast && item.staccato ? STACCATO_RATIO : 1);
  }, 0);
  return beats * secondsPerBeat;
}

function releaseSecondsOf(group) {
  const last = group.items[group.items.length - 1];
  return last.staccato ? STACCATO_RELEASE_SECONDS : RELEASE_SECONDS;
}

// stringNum: 発音する弦番号。タイで連結された和音グループは、配列の並び順ではなく弦番号で
// 対応するピッチを追いかけて1本のOscillatorNodeを継続させる(単音・非タイの和音は常にitems.length===1)。
// 弦をまたぐスライドでは連結先の弦番号が変わるため、pitchOnStringが単音のフォールバックを返す
function scheduleVoice(ctx, tuning, group, stringNum, groupStart, secondsPerBeat, activeNodes, octaveUp) {
  // 波形は撥弦した瞬間の音高で生成し、以降のピッチ変化(スライド・ハンマリング/プリング)は
  // 再生速度で表現する。存在しない弦を参照している音は周波数を決められないため鳴らさない
  const baseFreq = frequencyForPitch(tuning, pitchOnString(group.items[0], stringNum), octaveUp);
  if (baseFreq == null) return;

  const source = ctx.createBufferSource();
  source.buffer = getPluckBuffer(ctx, baseFreq);
  const gain = ctx.createGain();

  let t = groupStart;
  group.items.forEach((item, i) => {
    const dur = getEntryBeats(item) * secondsPerBeat;
    const freq = frequencyForPitch(tuning, pitchOnString(item, stringNum), octaveUp);
    const prevItem = group.items[i - 1];
    if (freq != null && (!prevItem || prevItem.articulation !== 'slide')) {
      source.playbackRate.setValueAtTime(freq / baseFreq, t);
    }
    const nextItem = group.items[i + 1];
    if (item.articulation === 'slide' && nextItem) {
      const nextFreq = frequencyForPitch(tuning, pitchOnString(nextItem, stringNum), octaveUp);
      if (nextFreq != null) source.playbackRate.linearRampToValueAtTime(nextFreq / baseFreq, t + dur);
    }
    t += dur;
  });

  const releaseEnd = scheduleEnvelope(gain, groupStart, soundSeconds(group, secondsPerBeat), {
    release: releaseSecondsOf(group),
  });

  source.connect(gain);
  gain.connect(getMasterGain());
  source.start(groupStart);
  source.stop(releaseEnd + 0.02);
  activeNodes.push({ osc: source, gain, endsAt: releaseEnd + 0.02 });
}

// ゴースト(ミュート)ピッチ1音分を、通知された長さに関わらず短いパーカッシブな減衰で発音する。
// 減衰は波形側(ミュート用に減衰時間を極端に短くしたもの)に含まれている
function scheduleGhostPitch(ctx, tuning, pitch, startTime, activeNodes, octaveUp) {
  const freq = frequencyForPitch(tuning, pitch, octaveUp);
  if (freq == null) return; // 存在しない弦を参照している音は鳴らさない

  const source = ctx.createBufferSource();
  source.buffer = getPluckBuffer(ctx, freq, true);
  const gain = ctx.createGain();
  const endTime = startTime + source.buffer.duration;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(GHOST_PEAK_GAIN, startTime + ATTACK_SECONDS);

  source.connect(gain);
  gain.connect(getMasterGain());
  source.start(startTime);
  source.stop(endTime + 0.02);
  activeNodes.push({ osc: source, gain, endsAt: endTime + 0.02 });
}

const CLICK_ATTACK_SECONDS = 0.004;
const CLICK_DECAY_SECONDS = 0.06;
const clickTrackCache = new Map();

// クリック音1つ分を波形へ書き込む(従来の矩形波+短い減衰と同じ音)
function renderClick(data, offset, sampleRate, accent) {
  const freq = accent ? 1500 : 1000;
  const peak = accent ? 0.25 : 0.15;
  const length = Math.floor(sampleRate * (CLICK_DECAY_SECONDS + 0.02));
  const decayRate = Math.log(0.0001 / peak) / (CLICK_DECAY_SECONDS - CLICK_ATTACK_SECONDS);

  for (let i = 0; i < length && offset + i < data.length; i++) {
    const t = i / sampleRate;
    const envelope =
      t < CLICK_ATTACK_SECONDS
        ? peak * (t / CLICK_ATTACK_SECONDS)
        : peak * Math.exp(decayRate * (t - CLICK_ATTACK_SECONDS));
    data[offset + i] += envelope * (Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1);
  }
}

/**
 * メトロノーム1小節分の波形を返す(先頭拍がアクセント)。曲の長さぶんクリック音のノードを
 * 並べると、長い曲では数百ノードになってオーディオスレッドの負荷が跳ね上がるため、
 * 1小節をループ再生する1ノードで賄う。アクセントの周期は小節と一致するのでループで表現できる
 */
function getClickTrackBuffer(ctx, tempo, beatsPerMeasure) {
  const key = `${ctx.sampleRate}:${tempo}:${beatsPerMeasure}`;
  const cached = clickTrackCache.get(key);
  if (cached) return cached;

  const secondsPerBeat = 60 / tempo;
  const length = Math.max(1, Math.round(ctx.sampleRate * secondsPerBeat * beatsPerMeasure));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let beat = 0; beat < beatsPerMeasure; beat++) {
    renderClick(data, Math.round(beat * secondsPerBeat * ctx.sampleRate), ctx.sampleRate, beat === 0);
  }

  clickTrackCache.set(key, buffer);
  return buffer;
}

function scheduleMetronome(ctx, tempo, beatsPerMeasure, startTime, endTime, activeNodes) {
  const source = ctx.createBufferSource();
  source.buffer = getClickTrackBuffer(ctx, tempo, beatsPerMeasure);
  source.loop = true;
  const gain = ctx.createGain();

  source.connect(gain);
  gain.connect(getMasterGain());
  source.start(startTime);
  source.stop(endTime);
  activeNodes.push({ osc: source, gain, endsAt: endTime });
}

/**
 * 再生に使う音高の波形を先に生成しておく。音高ごとの生成は初回だけコストがかかるため、
 * 再生開始時刻を決める前に済ませておかないと、予約し終える前に開始時刻を過ぎて
 * 冒頭の音が詰まって鳴ってしまう
 * @param {object} tabData
 * @param {{name:string, octave:number}[]} tuning
 * @param {{octaveUp?: boolean, startIndex?: number}} [options]
 */
export function warmUpVoices(tabData, tuning, { octaveUp = false, startIndex = 0 } = {}) {
  const ctx = getAudioContext();
  for (let i = startIndex; i < tabData.notes.length; i++) {
    const entry = tabData.notes[i];
    if (entry.type !== 'note') continue;
    entry.notes.forEach((pitch) => {
      const freq = frequencyForPitch(tuning, pitch, octaveUp);
      if (freq != null) getPluckBuffer(ctx, freq, Boolean(pitch.ghost));
    });
  }
}

/**
 * @param {object} tabData
 * @param {{name:string, octave:number}[]} tuning
 * @param {{tempo?: number, timeSignature?: string, metronome?: boolean, octaveUp?: boolean, startIndex?: number, startAt?: number, onNoteStart?: (index:number) => void, onEnd?: () => void}} [options]
 */
export function playTab(
  tabData,
  tuning,
  {
    tempo = 120,
    timeSignature = '4/4',
    metronome = false,
    octaveUp = false,
    startIndex = 0,
    startAt,
    onNoteStart,
    onEnd,
  } = {}
) {
  const ctx = getAudioContext();
  const secondsPerBeat = 60 / tempo;
  const { beatsPerMeasure } = parseTimeSignature(timeSignature);
  // 同時再生では全トラックで共通の開始時刻(`playbackStartTime`)を受け取り、トラック間のずれを防ぐ
  const startTime = startAt ?? ctx.currentTime + LOOKAHEAD_PAD;

  let activeNodes = [];
  let timers = [];
  // startIndexより前を除外して再生する。タイ/ハンマリング等の連結途中から始まる場合は
  // 単独の音符として扱う(直前の音が鳴らないため自然な挙動)
  const notesToPlay = tabData.notes.slice(startIndex);
  const groups = groupEntries(notesToPlay);

  // 各グループの開始時刻を先に算出しておく(ここではノードを作らない)。
  // 実際のノード生成は再生の進行に合わせて少しずつ行う
  let cursor = startTime;
  const plan = groups.map((group) => {
    const groupStart = cursor;
    cursor += group.items.reduce((sum, item) => sum + getEntryBeats(item) * secondsPerBeat, 0);
    return { group, groupStart };
  });
  const totalEndTime = cursor;

  function scheduleGroup({ group, groupStart }) {
    const first = group.items[0];
    if (first.type === 'note') {
      // ゴースト(ミュート)ピッチと通常のフレット音が1つの和音に混在する場合があるため、
      // ピッチごとに振り分けて発音する(ゴーストはグループ化されない=常にitems.length===1)
      first.notes.forEach((pitch) => {
        if (pitch.ghost) {
          scheduleGhostPitch(ctx, tuning, pitch, groupStart, activeNodes, octaveUp);
        } else {
          scheduleVoice(ctx, tuning, group, pitch.string, groupStart, secondsPerBeat, activeNodes, octaveUp);
        }
      });
    }

    if (onNoteStart) {
      let subT = groupStart;
      group.items.forEach((item, i) => {
        const delayMs = Math.max(0, (subT - ctx.currentTime) * 1000);
        const idx = startIndex + group.startIndex + i;
        timers.push(setTimeout(() => onNoteStart(idx), delayMs));
        subT += getEntryBeats(item) * secondsPerBeat;
      });
    }
  }

  // 直近SCHEDULE_AHEAD_SECONDS秒ぶんだけを予約し、鳴り終わったノードは参照を手放す。
  // 曲の全音符を最初にまとめて予約すると、接続済みノードは発音中かどうかに関わらず
  // オーディオスレッドで毎レンダー処理されるため、長い曲・同時再生で処理落ちする
  let nextIndex = 0;
  let schedulerId = null;

  function pump() {
    const until = ctx.currentTime + SCHEDULE_AHEAD_SECONDS;
    while (nextIndex < plan.length && plan[nextIndex].groupStart < until) {
      scheduleGroup(plan[nextIndex]);
      nextIndex += 1;
    }
    const now = ctx.currentTime;
    activeNodes = activeNodes.filter((n) => n.endsAt > now);
    if (nextIndex >= plan.length && schedulerId !== null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  pump(); // 冒頭ぶんはこの場で予約する(開始時刻が目前のため待てない)
  if (nextIndex < plan.length) {
    schedulerId = setInterval(pump, SCHEDULER_INTERVAL_MS);
  }

  // メトロノームは1小節分をループする1ノードのみなので、曲の長さに関わらず先に予約してよい
  if (metronome && totalEndTime > startTime) {
    scheduleMetronome(ctx, tempo, beatsPerMeasure, startTime, totalEndTime, activeNodes);
  }

  if (onEnd) {
    const delayMs = Math.max(0, (totalEndTime - ctx.currentTime) * 1000);
    timers.push(setTimeout(onEnd, delayMs));
  }

  return {
    stop() {
      if (schedulerId !== null) {
        clearInterval(schedulerId);
        schedulerId = null;
      }
      nextIndex = plan.length; // 保留中のpumpが走っても以後は何も予約しない
      const now = ctx.currentTime;
      activeNodes.forEach(({ osc, gain }) => {
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
          osc.stop(now + 0.04);
        } catch {
          // 既に停止済みのノードは無視する
        }
      });
      activeNodes = [];
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}
