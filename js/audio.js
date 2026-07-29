// Web Audio APIによる音声再生(音声ファイルは使用せずその場でシンセサイズする)

import { getPluckBuffer } from './pluck.js';

let audioCtx = null;
let masterGain = null;
let masterVolumeValue = 0.8;

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolumeValue;

    // 和音・同時再生・速いパッセージで発音が重なると合計振幅が振り切れ、破裂したような
    // 歪みになる。出力の最終段でピークを抑えて、音量設定に関わらずこれを防ぐ
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.2;

    masterGain.connect(limiter);
    limiter.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 指板クリック音・TAB再生音・メトロノーム音など全ての発音をこのノードに通す
export function getMasterGain() {
  getAudioContext();
  return masterGain;
}

export function setMasterVolume(value) {
  masterVolumeValue = Math.min(1, Math.max(0, value));
  if (masterGain) {
    masterGain.gain.value = masterVolumeValue;
  }
}

export function getMasterVolume() {
  return masterVolumeValue;
}

const PEAK_GAIN = 0.32;

// 指板クリック音。TAB再生と同じKarplus-Strongの撥弦音で鳴らす(減衰は波形自体に含まれる)。
// outputにアクティブTABのエフェクトチェーンを渡すと、その場で鳴らしている楽器の音として聞こえる
export function playFrequency(freq, output) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = getPluckBuffer(ctx, freq);
  const gain = ctx.createGain();

  // クリックノイズを避けるための短いフェードインのみを付ける
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + 0.002);

  source.connect(gain);
  gain.connect(output ?? getMasterGain());

  source.start(now);
  source.stop(now + source.buffer.duration + 0.02);
}
