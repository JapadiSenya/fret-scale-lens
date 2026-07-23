// Web Audio APIによる音声再生(音声ファイルは使用せずその場でシンセサイズする)

let audioCtx = null;
let masterGain = null;
let masterVolumeValue = 0.8;

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolumeValue;
    masterGain.connect(audioCtx.destination);
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

const PEAK_GAIN = 0.4;
const DECAY_SECONDS = 0.8;

export function playFrequency(freq) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);

  // クリックノイズを避けつつ、自然な減衰エンベロープを付与する
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + DECAY_SECONDS);

  osc.connect(gain);
  gain.connect(getMasterGain());

  osc.start(now);
  osc.stop(now + DECAY_SECONDS + 0.05);
}
