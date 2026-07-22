// Web Audio APIによる音声再生(音声ファイルは使用せずその場でシンセサイズする)

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
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
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + DECAY_SECONDS + 0.05);
}
