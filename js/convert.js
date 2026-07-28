// TAB JSON形式変換ツール(convert.html)の処理

import { migrateTabData } from './tab.js';

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

// {tab, settings}形式・単体tabData形式のどちらも受け付け、notesエントリのみ新フォーマットへ変換する
// (settingsは検証・変更せずそのまま保持する)
function convertPayload(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.tab && typeof parsed.tab === 'object' && Array.isArray(parsed.tab.notes)) {
    return { ...parsed, tab: migrateTabData(parsed.tab) };
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
