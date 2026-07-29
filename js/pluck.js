// 撥弦楽器(ベース/ギター)の音をKarplus-Strong法で合成する。
//
// オシレータの静的な波形は倍音構成が最後まで変わらないため電子音的に聞こえるが、
// この方法は「ノイズを詰めた遅延線をローパスを通して自己帰還させる」という構造上、
// 高い倍音から先に減衰していくという撥弦楽器の最大の特徴が自然に再現される。
//
// 生成した波形は音高ごとにキャッシュし、発音時はAudioBufferSourceNodeで鳴らす
// (AudioWorkletと違い開始時刻を指定できるため、再生開始時に全ノードを一括で予約する
// 既存のスケジューリング構造をそのまま使える)

const MAX_SECONDS = 4; // 1音あたりの波形長の上限(これを超えて鳴り続ける音は実際にはほぼ無音)
const FADE_OUT_SECONDS = 0.02; // 波形末尾を絞ってプツッというノイズを防ぐ

// 音高ごとの生成結果。キーは「muted有無 + 周波数」
const bufferCache = new Map();

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

// 弦の性格を音域(周波数)から連続的に決める。楽器種別という概念を持たずに
// 「低音弦は太く長く鳴り、高音弦は短く明るく鳴る」という差を出すための近似
function stringCharacter(freq) {
  // ベース最低音E1(約41Hz)〜ギター高音域(約660Hz)を0〜1に写す
  const t = clamp((Math.log2(freq) - Math.log2(41)) / (Math.log2(660) - Math.log2(41)), 0, 1);
  return {
    t60: lerp(5.5, 1.7, t), // 60dB減衰するまでの時間(秒)
    pluckPosition: lerp(0.3, 0.22, t), // 弦のどこを弾くか(0〜1)。端に近いほど硬い音になる
    noiseAmount: lerp(0.07, 0.16, t), // ピックが弦に当たる瞬間のノイズの量
    loopMix: lerp(0.62, 0.5, t), // ループフィルタの重み(大きいほど高い倍音が速く減衰する)
    toneCutoff: lerp(2000, 4200, t), // ボディ/ピックアップによる高域の丸まりの近似(Hz)
  };
}

// ミュート(ゴースト)ピッチ。ほぼ減衰音だけが残る短いパーカッシブな音になる
const MUTED_CHARACTER = {
  t60: 0.12,
  pluckPosition: 0.18,
  noiseAmount: 0.5,
  loopMix: 0.7,
  toneCutoff: 3000,
};

/**
 * Karplus-Strongで1音分の波形を生成する。
 * @param {number} sampleRate
 * @param {number} freq 基音の周波数(Hz)
 * @param {{t60:number, pickBrightness:number, loopMix:number}} character
 * @returns {Float32Array}
 */
function renderPluckWave(sampleRate, freq, { t60, pluckPosition, noiseAmount, loopMix, toneCutoff }) {
  const outLength = Math.max(1, Math.floor(sampleRate * Math.min(t60 * 1.15, MAX_SECONDS)));
  // 遅延線の長さ=1周期分。整数に丸めると音程がずれるため、読み出しは小数位置で線形補間する。
  // ループを1周する遅延には、後段の一次ローパスの群遅延(≒loopMixサンプル)も加わるため、
  // その分を差し引かないと音程が低くなる(周期の短い高音ほど誤差が大きく、無視できない)
  const delay = Math.max(2, sampleRate / freq - loopMix);
  const lineLength = Math.max(2, Math.ceil(delay) + 2);
  const line = new Float32Array(lineLength);

  // 撥弦の瞬間の弦の形は「弾いた点を頂点とする三角形」に近い。この形で励振すると倍音が
  // 1/n^2 で減衰する自然な立ち上がりになる。白色ノイズだけで励振すると全ての倍音が同じ強さで
  // 立ち上がるため、硬く軽い音になり、アタックが全振幅のスパイクになってしまう。
  // ピックが弦に当たる瞬間のノイズは、その上に少量だけ重ねる
  const peakIndex = Math.max(1, Math.min(lineLength - 1, Math.round(lineLength * pluckPosition)));
  let sum = 0;
  for (let i = 0; i < lineLength; i++) {
    const shape = i < peakIndex ? i / peakIndex : (lineLength - i) / (lineLength - peakIndex);
    const value = shape + noiseAmount * (Math.random() * 2 - 1);
    line[i] = value;
    sum += value;
  }
  // 直流成分が残るとループを回るうちに音が濁るため取り除く(三角形は特に直流が大きい)
  const mean = sum / lineLength;
  for (let i = 0; i < lineLength; i++) line[i] -= mean;

  // 基音がt60秒で60dB落ちるループゲイン(倍音の減衰はループフィルタ側が受け持つ)
  const loopGain = Math.pow(10, -3 / (t60 * sampleRate));

  // 楽器のボディ/ピックアップで高域が丸められるぶんを一次ローパスで近似する
  const toneCoeff = 1 - Math.exp((-2 * Math.PI * toneCutoff) / sampleRate);
  let tone = 0;

  const out = new Float32Array(outLength);
  let write = 0;
  let last = 0;
  let peak = 0;
  for (let n = 0; n < outLength; n++) {
    let readPos = write - delay;
    if (readPos < 0) readPos += lineLength;
    const i0 = Math.floor(readPos);
    const frac = readPos - i0;
    const delayed = line[i0 % lineLength] * (1 - frac) + line[(i0 + 1) % lineLength] * frac;

    const filtered = (1 - loopMix) * delayed + loopMix * last; // 一次ローパス(高い倍音ほど速く減衰する)
    last = delayed;

    const sample = filtered * loopGain;
    line[write] = sample;
    write = (write + 1) % lineLength;

    tone += toneCoeff * (sample - tone);
    out[n] = tone;

    const abs = Math.abs(tone);
    if (abs > peak) peak = abs;
  }

  if (peak > 0) {
    const scale = 1 / peak;
    for (let n = 0; n < outLength; n++) out[n] *= scale;
  }

  const fadeSamples = Math.min(Math.floor(sampleRate * FADE_OUT_SECONDS), outLength);
  for (let i = 0; i < fadeSamples; i++) {
    out[outLength - fadeSamples + i] *= 1 - i / fadeSamples;
  }

  return out;
}

/**
 * 指定した音高の撥弦波形を`AudioBuffer`として返す(同じ音高は生成結果を使い回す)。
 * @param {BaseAudioContext} ctx
 * @param {number} freq
 * @param {boolean} [muted] ゴースト(ミュート)ピッチとして鳴らすか
 * @returns {AudioBuffer}
 */
export function getPluckBuffer(ctx, freq, muted = false) {
  const key = `${muted ? 'm' : 'n'}:${ctx.sampleRate}:${Math.round(freq * 100)}`;
  const cached = bufferCache.get(key);
  if (cached) return cached;

  const character = muted ? MUTED_CHARACTER : stringCharacter(freq);
  const wave = renderPluckWave(ctx.sampleRate, freq, character);
  const buffer = ctx.createBuffer(1, wave.length, ctx.sampleRate);
  buffer.copyToChannel(wave, 0);
  bufferCache.set(key, buffer);
  return buffer;
}
