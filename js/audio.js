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
const ATTACK_SECONDS = 0.002;

// 指板クリック音は「今どの音か」を確かめるための試聴なので、TAB再生の音符と違って終わりの
// タイミングが決まっていない。波形は減衰しきるまで数秒あるため、十分に減衰したところで
// 切り上げて、次の入力までいつまでも尾を引かないようにする
const CLICK_SOUND_SECONDS = 1.5;
const CLICK_RELEASE_SECONDS = 0.2;
// 次の音を鳴らすときは、前の音を弦に触れて止めるように素早く減衰させる。
// 上限の長さを設けるだけでは、それより速い間隔で入力したときの重なりは防げないため
const CLICK_CUT_SECONDS = 0.05;

// 鳴っている(予定を含む)クリック音。次のクリック時に止めるために保持する
let clickVoices = [];

/** 鳴っているクリック音を素早く減衰させて止める */
function cutClickVoices(ctx, now) {
  clickVoices.forEach(({ source, gain, endsAt }) => {
    if (endsAt <= now) return;
    const cutEnd = now + CLICK_CUT_SECONDS;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, cutEnd);
    try {
      source.stop(cutEnd + 0.01);
    } catch (error) {
      console.error(error);
    }
  });
  clickVoices = [];
}

// 指板クリック音。TAB再生と同じKarplus-Strongの撥弦音で鳴らす(減衰は波形自体に含まれる)。
// outputにアクティブTABのエフェクトチェーンを渡すと、その場で鳴らしている楽器の音として聞こえる
export function playFrequency(freq, output) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  cutClickVoices(ctx, now);

  const source = ctx.createBufferSource();
  source.buffer = getPluckBuffer(ctx, freq);
  const gain = ctx.createGain();

  // 減衰は波形自体に含まれるため、ここではクリックノイズを避けるフェードインと、
  // 鳴らす長さを打ち切るための余韻(リリース)だけを担う
  const sound = Math.min(CLICK_SOUND_SECONDS, source.buffer.duration);
  const releaseEnd = now + sound + CLICK_RELEASE_SECONDS;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + ATTACK_SECONDS);
  gain.gain.setValueAtTime(PEAK_GAIN, now + sound);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

  source.connect(gain);
  gain.connect(output ?? getMasterGain());

  source.start(now);
  source.stop(releaseEnd + 0.02);

  clickVoices.push({ source, gain, endsAt: releaseEnd + 0.02 });
}
