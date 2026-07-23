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

function frequencyForEntry(tuning, entry, octaveUp) {
  const openString = tuning[entry.string];
  if (!openString) return null;
  const note = noteAtFret(openString.name, openString.octave, entry.fret);
  const freq = frequencyOf(note.name, note.octave);
  return octaveUp ? freq * 2 : freq;
}

// タイ/ハンマリング/プリング/スライドで連結された連続音符を1つの発音グループにまとめる
function groupEntries(notes) {
  const groups = [];
  notes.forEach((entry, i) => {
    const prev = notes[i - 1];
    const linkedToPrev =
      prev && prev.type === 'note' && entry.type === 'note' &&
      ['tie', 'hammerOn', 'pullOff', 'slide'].includes(prev.articulation || '');
    if (linkedToPrev) {
      groups[groups.length - 1].items.push(entry);
    } else {
      groups.push({ startIndex: i, items: [entry] });
    }
  });
  return groups;
}

function scheduleVoice(ctx, tuning, group, groupStart, secondsPerBeat, activeNodes, octaveUp) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';

  let t = groupStart;
  let totalDuration = 0;
  group.items.forEach((item, i) => {
    const dur = getEntryBeats(item) * secondsPerBeat;
    const freq = frequencyForEntry(tuning, item, octaveUp);
    const prevItem = group.items[i - 1];
    if (!prevItem || prevItem.articulation !== 'slide') {
      osc.frequency.setValueAtTime(freq, t);
    }
    const nextItem = group.items[i + 1];
    if (item.articulation === 'slide' && nextItem) {
      const nextFreq = frequencyForEntry(tuning, nextItem, octaveUp);
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

function scheduleGhost(ctx, tuning, entry, startTime, activeNodes, octaveUp) {
  const freq = frequencyForEntry(tuning, entry, octaveUp);
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
 * @param {{metronome?: boolean, octaveUp?: boolean, startIndex?: number, onNoteStart?: (index:number) => void, onEnd?: () => void}} [options]
 */
export function playTab(tabData, tuning, { metronome = false, octaveUp = false, startIndex = 0, onNoteStart, onEnd } = {}) {
  const ctx = getAudioContext();
  const bpm = tabData.tempoEvents[0]?.bpm || 120;
  const secondsPerBeat = 60 / bpm;
  const { beatsPerMeasure } = parseTimeSignature(tabData.timeSignature);
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
      scheduleVoice(ctx, tuning, group, groupStart, secondsPerBeat, activeNodes, octaveUp);
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
