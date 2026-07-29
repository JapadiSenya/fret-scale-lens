// TABごとのエフェクトチェーン。各TABの発音はここを通ってからマスターへ送られる
// (メトロノームのクリック音は楽器音ではないためチェーンを通さない)

const CURVE_SAMPLES = 2048;

export const EFFECT_TYPES = [{ id: 'distortion', label: 'ディストーション' }];

export const EFFECT_PARAMS = {
  distortion: [
    { key: 'drive', label: '歪み', defaultValue: 0.5 },
    { key: 'tone', label: 'トーン', defaultValue: 0.5 },
    { key: 'level', label: '音量', defaultValue: 0.8 },
  ],
};

export function createEffect(type) {
  const params = EFFECT_PARAMS[type] || [];
  return {
    type,
    enabled: true,
    ...Object.fromEntries(params.map((p) => [p.key, p.defaultValue])),
  };
}

const clamp01 = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

// 不正な値・未知の種類を取り除いて、扱える形に正規化する(JSON直接編集やimportを経由するため)
export function normalizeEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((e) => e && EFFECT_PARAMS[e.type])
    .map((e) => ({
      type: e.type,
      enabled: e.enabled !== false,
      ...Object.fromEntries(EFFECT_PARAMS[e.type].map((p) => [p.key, clamp01(e[p.key], p.defaultValue)])),
    }));
}

// tanh系のソフトクリップ。driveを上げるほど早く飽和し、倍音が増える
function makeDistortionCurve(drive) {
  const k = 1 + drive * 30;
  const curve = new Float32Array(CURVE_SAMPLES);
  const scale = Math.tanh(k);
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = (i * 2) / (CURVE_SAMPLES - 1) - 1;
    curve[i] = Math.tanh(k * x) / scale;
  }
  return curve;
}

function buildDistortion(ctx, effect) {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(effect.drive);
  shaper.oversample = '4x'; // 歪みで生じる高い倍音の折り返し(エイリアシング)を抑える

  // 歪ませると小さい音まで持ち上がって音量が大きく上がるため、driveに応じて戻してからlevelを掛ける
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 800 * Math.pow(10, effect.tone); // 800Hz〜8000Hz
  tone.Q.value = 0.7;

  const output = ctx.createGain();
  output.gain.value = effect.level / (1 + effect.drive * 2);

  shaper.connect(tone);
  tone.connect(output);
  return { input: shaper, output, nodes: [shaper, tone, output] };
}

const BUILDERS = { distortion: buildDistortion };

/**
 * エフェクトチェーンを組み立てる。入力ノードへ繋いだ音がdestinationへ流れる
 * @returns {{input: AudioNode, dispose: () => void}}
 */
export function createEffectChain(ctx, effects, destination) {
  const input = ctx.createGain();
  const nodes = [input];

  let tail = input;
  normalizeEffects(effects).forEach((effect) => {
    if (!effect.enabled) return; // OFFのエフェクトは設定を保持したままバイパスする
    const built = BUILDERS[effect.type]?.(ctx, effect);
    if (!built) return;
    tail.connect(built.input);
    tail = built.output;
    nodes.push(...built.nodes);
  });

  tail.connect(destination);

  return {
    input,
    dispose() {
      nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          // 既に切断済みのノードは無視する
        }
      });
    },
  };
}
