// TAB JSON形式変換ツール(convert.html)の処理

import { migrateTabData, legacyTempoOf, legacyTimeSignatureOf } from './tab.js';

const fileInput = document.getElementById('convert-file-input');
const inputTextarea = document.getElementById('convert-input-textarea');
const outputTextarea = document.getElementById('convert-output-textarea');
const errorEl = document.getElementById('convert-error');
const downloadBtn = document.getElementById('convert-download-btn');

let convertedPayload = null;
let convertedFileName = 'converted.json';

function setError(message) {
  errorEl.textContent = message;
  errorEl.classList.toggle('visible', Boolean(message));
}

function clearOutput() {
  outputTextarea.value = '';
  downloadBtn.disabled = true;
  convertedPayload = null;
}

function isValidTuning(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((s) => s && typeof s === 'object' && typeof s.name === 'string' && Number.isInteger(s.octave))
  );
}

// {tab, settings}形式・単体tabData形式のどちらも受け付け、以下を新フォーマットへ変換する:
//   - notesエントリ(string/fret直持ち→notes配列形式。旧チョード非対応形式からの変換を含む)
//   - チューニング/フレット数(旧形式ではsettings側にあった → tab側へ)
//   - テンポ/拍子(旧形式ではtab側にあった → settings側へ)
// 新フォーマットの入力(tabに既にtuning/fretCountがある等)に対しては何もしない(冪等)
function convertPayload(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.tab && typeof parsed.tab === 'object' && Array.isArray(parsed.tab.notes)) {
    const tabSource = parsed.tab;
    const settingsSource = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null;

    const tuningFallback = isValidTuning(settingsSource?.tuning) ? settingsSource.tuning : undefined;
    const fretCountFallback = Number.isFinite(settingsSource?.fretCount) ? settingsSource.fretCount : undefined;
    const tab = migrateTabData(tabSource, { tuning: tuningFallback, fretCount: fretCountFallback });

    if (!settingsSource) return { tab };

    const settings = { ...settingsSource };
    delete settings.tuning;
    delete settings.fretCount;
    if (settings.tempo === undefined) {
      const legacyTempo = legacyTempoOf(tabSource);
      if (legacyTempo != null) settings.tempo = legacyTempo;
    }
    if (settings.timeSignature === undefined) {
      const legacyTimeSignature = legacyTimeSignatureOf(tabSource);
      if (legacyTimeSignature != null) settings.timeSignature = legacyTimeSignature;
    }
    return { tab, settings };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.notes)) {
    return migrateTabData(parsed);
  }
  throw new Error('notes配列を含むTABデータ({ tab, settings }形式、または単体のtabData形式)である必要があります。');
}

function fileNameFor(payload) {
  const title = payload?.tab?.title ?? payload?.title;
  return typeof title === 'string' && title.trim() ? `${title.trim()}.json` : 'converted.json';
}

function runConversion(text) {
  if (!text.trim()) {
    clearOutput();
    setError('');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    clearOutput();
    setError(`JSON構文エラー: ${e.message}`);
    return;
  }

  try {
    const converted = convertPayload(parsed);
    convertedPayload = converted;
    convertedFileName = fileNameFor(converted);
    outputTextarea.value = JSON.stringify(converted, null, 2);
    downloadBtn.disabled = false;
    setError('');
  } catch (e) {
    clearOutput();
    setError(e.message);
  }
}

inputTextarea.addEventListener('input', () => runConversion(inputTextarea.value));

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  inputTextarea.value = text;
  runConversion(text);
  fileInput.value = '';
});

downloadBtn.addEventListener('click', () => {
  if (!convertedPayload) return;
  const blob = new Blob([JSON.stringify(convertedPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = convertedFileName;
  a.click();
  URL.revokeObjectURL(url);
});
