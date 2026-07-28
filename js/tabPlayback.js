// TAB譜の再生(tempoEvents・durationから実時間へ変換して順次再生)とメトロノーム

import { noteAtFret, frequencyOf } from './notes.js';
import { getAudioContext, getMasterGain } from './audio.js';
import { getEntryBeats, parseTimeSignature } from './tab.js';

const LOOKAHEAD_PAD = 0.05;

const ATTACK_SECONDS = 0.01;
const INITIAL_DECAY_SECONDS = 0.08;
const RELEASE_SECONDS = 0.12;
const VOICE_PEAK_GAIN = 0.4;
const VOICE_SUSTAIN_RATIO = 0.45;

// 音符長いっぱいまで音量を保持し、末尾だけ短くリリースするエンベロープ(アタック→減衰→サステイン→リリース)を組む
function scheduleEnvelope(gain, startTime, duration, peak = VOICE_PEAK_GAIN) {
  const sustainLevel = Math.max(peak * VOICE_SUSTAIN_RATIO, 0.0001);
  const attackEnd = startTime + Math.min(ATTACK_SECONDS, duration);
  const decayEnd = Math.min(attackEnd + INITIAL_DECAY_SECONDS, startTime + duration);
  const noteEnd = startTime + duration;
  const releaseStart = Math.max(decayEnd, noteEnd - RELEASE_SECONDS);
  const releaseEnd = Math.max(noteEnd, releaseStart + 0.01);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
  if (releaseStart > decayEnd) {
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

  return releaseEnd;
}

function frequencyForPitch(tuning, pitch, octaveUp) {
  const openString = tuning[pitch.string];
  if (!openString) return null;
  const note = noteAtFret(openString.name, openString.octave, pitch.fret);
  const freq = frequencyOf(note.name, note.octave);
  return octaveUp ? freq * 2 : freq;
}

// タイ/ハンマリング/プリング/スライドで連結された連続音符を1つの発音グループにまとめる
// (和音=notes.length>1のエントリはこれらのarticulationの連結元/連結先になれないため対象外)
function groupEntries(notes) {
  const groups = [];
  notes.forEach((entry, i) => {
    const prev = notes[i - 1];
    const linkedToPrev =
      prev && prev.type === 'note' && entry.type === 'note' &&
      prev.notes.length === 1 && entry.notes.length === 1 &&
      ['tie', 'hammerOn', 'pullOff', 'slide'].includes(prev.articulation || '');
    if (linkedToPrev) {
      groups[groups.length - 1].items.push(entry);
    } else {
      groups.push({ startIndex: i, items: [entry] });
    }
  });
  return groups;
}

// pitchIndex: 和音の場合に鳴らす音を選ぶ添字。タイ等で連結されたグループは常に単音(notes.length===1)
// なので、和音は必ず単独(items.length===1)のグループとしてこの関数がnotes.length回呼ばれる
function scheduleVoice(ctx, tuning, group, pitchIndex, groupStart, secondsPerBeat, activeNodes, octaveUp) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';

  let t = groupStart;
  let totalDuration = 0;
  group.items.forEach((item, i) => {
    const dur = getEntryBeats(item) * secondsPerBeat;
    const freq = frequencyForPitch(tuning, item.notes[pitchIndex], octaveUp);
    const prevItem = group.items[i - 1];
    if (!prevItem || prevItem.articulation !== 'slide') {
      osc.frequency.setValueAtTime(freq, t);
    }
    const nextItem = group.items[i + 1];
    if (item.articulation === 'slide' && nextItem) {
      const nextFreq = frequencyForPitch(tuning, nextItem.notes[pitchIndex], octaveUp);
      osc.frequency.linearRampToValueAtTime(nextFreq, t + dur);
    }
    t += dur;
    totalDuration += dur;
  });

  const releaseEnd = scheduleEnvelope(gain, groupStart, totalDuration);

  osc.connect(gain);
  gain.connect(getMasterGain());
  osc.start(groupStart);
  osc.stop(releaseEnd + 0.02);
  activeNodes.push({ osc, gain });
}

// 和音の場合はnotes配列内の各ピッチを同時に発音する
function scheduleGhost(ctx, tuning, entry, startTime, activeNodes, octaveUp) {
  entry.notes.forEach((pitch) => {
    const freq = frequencyForPitch(tuning, pitch, octaveUp);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);

    osc.connect(gain);
    gain.connect(getMasterGain());
    osc.start(startTime);
    osc.stop(startTime + 0.15);
    activeNodes.push({ osc, gain });
  });
}

export function scheduleClick(time, accent, activeNodes) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 1500 : 1000, time);

  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.25 : 0.15, time + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

  osc.connect(gain);
  gain.connect(getMasterGain());
  osc.start(time);
  osc.stop(time + 0.08);
  activeNodes?.push({ osc, gain });
}

/**
 * @param {object} tabData
 * @param {{name:string, octave:number}[]} tuning
 * @param {{tempo?: number, timeSignature?: string, metronome?: boolean, octaveUp?: boolean, startIndex?: number, onNoteStart?: (index:number) => void, onEnd?: () => void}} [options]
 */
export function playTab(
  tabData,
  tuning,
  { tempo = 120, timeSignature = '4/4', metronome = false, octaveUp = false, startIndex = 0, onNoteStart, onEnd } = {}
) {
  const ctx = getAudioContext();
  const secondsPerBeat = 60 / tempo;
  const { beatsPerMeasure } = parseTimeSignature(timeSignature);
  const startTime = ctx.currentTime + LOOKAHEAD_PAD;

  const activeNodes = [];
  const timers = [];
  // startIndexより前を除外して再生する。タイ/ハンマリング等の連結途中から始まる場合は
  // 単独の音符として扱う(直前の音が鳴らないため自然な挙動)
  const notesToPlay = tabData.notes.slice(startIndex);
  const groups = groupEntries(notesToPlay);

  let t = startTime;
  groups.forEach((group) => {
    const groupStart = t;
    const totalDuration = group.items.reduce(
      (sum, item) => sum + getEntryBeats(item) * secondsPerBeat,
      0
    );
    const first = group.items[0];

    if (first.type === 'note') {
      for (let p = 0; p < first.notes.length; p++) {
        scheduleVoice(ctx, tuning, group, p, groupStart, secondsPerBeat, activeNodes, octaveUp);
      }
    } else if (first.type === 'ghost') {
      scheduleGhost(ctx, tuning, first, groupStart, activeNodes, octaveUp);
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

    t += totalDuration;
  });

  const totalEndTime = t;

  if (metronome) {
    let beatIndex = 0;
    for (let time = startTime; time < totalEndTime - 0.001; time += secondsPerBeat) {
      scheduleClick(time, beatIndex % beatsPerMeasure === 0, activeNodes);
      beatIndex++;
    }
  }

  if (onEnd) {
    const delayMs = Math.max(0, (totalEndTime - ctx.currentTime) * 1000);
    timers.push(setTimeout(onEnd, delayMs));
  }

  return {
    stop() {
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
      timers.forEach(clearTimeout);
    },
  };
}
