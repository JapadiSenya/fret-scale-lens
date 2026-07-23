// TAB譜表示エリアのDOM描画

import { computeMeasureBreaks } from './tab.js';
import { NOTE_NAMES, noteAtFret } from './notes.js';
import { isRootNote, isInScale, getDegreeInfo } from './scales.js';

const ARTICULATION_SUFFIX = {
  tie: '~',
  hammerOn: 'h',
  pullOff: 'p',
  slide: '/',
};

const DURATION_SYMBOL = {
  whole: '𝅝',
  half: '𝅗𝅥',
  quarter: '𝅘𝅥',
  '8th': '𝅘𝅥𝅮',
  '16th': '𝅘𝅥𝅯',
};

const DURATION_JA = {
  whole: '全音符',
  half: '2分音符',
  quarter: '4分音符',
  '8th': '8分音符',
  '16th': '16分音符',
};

function inRange(index, selection) {
  if (!selection) return false;
  const { start, end } = selection;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return index >= from && index <= to;
}

// フレットボード側(render.js)と同じ配色ルールをTAB譜の数字にも適用する
function colorClassesForEntry(entry, tuning, colorSync, key, scale, displayMode) {
  if (!colorSync || entry.type !== 'note') return [];
  const openString = tuning[entry.string];
  if (!openString) return [];
  const note = noteAtFret(openString.name, openString.octave, entry.fret);
  const noteIndex = NOTE_NAMES.indexOf(note.name);
  const rootIndex = NOTE_NAMES.indexOf(key);
  const root = isRootNote(noteIndex, rootIndex);

  if (displayMode === 'function') {
    const degreeInfo = getDegreeInfo(noteIndex, rootIndex, scale);
    if (!degreeInfo) return [];
    const funcClass = degreeInfo.func ? `tab-color-function-${degreeInfo.func.toLowerCase()}` : 'tab-color-function-neutral';
    return root ? [funcClass, 'tab-color-root-accent'] : [funcClass];
  }

  if (root) return ['tab-color-root'];
  if (isInScale(noteIndex, rootIndex, scale)) return ['tab-color-in-scale'];
  return [];
}

/**
 * @param {HTMLElement} container
 * @param {{tabData: object, tuning: {name:string, octave:number}[], selection: {start:number, end:number}|null, playingIndex: number|null, key: string, scale: string, displayMode: 'scale'|'function', colorSync: boolean}} view
 * @param {{onColumnClick?: (index:number, event:MouseEvent) => void}} [callbacks]
 */
export function renderTab(
  container,
  { tabData, tuning, selection, playingIndex, key, scale, displayMode, colorSync },
  { onColumnClick } = {}
) {
  const displayStrings = [...tuning].reverse();
  const stringCount = displayStrings.length;
  const notes = tabData.notes;
  const breaks = computeMeasureBreaks(notes, tabData.timeSignature);

  const wrapper = document.createElement('div');
  wrapper.className = 'tab-grid';

  const labelCol = document.createElement('div');
  labelCol.className = 'tab-string-labels';
  displayStrings.forEach((s) => {
    const label = document.createElement('div');
    label.className = 'tab-string-label';
    label.textContent = `${s.name}${s.octave}`;
    labelCol.appendChild(label);
  });
  wrapper.appendChild(labelCol);

  const scrollArea = document.createElement('div');
  scrollArea.className = 'tab-scroll-area';

  notes.forEach((entry, index) => {
    if (breaks.has(index)) {
      const barLine = document.createElement('div');
      barLine.className = 'tab-bar-line';
      scrollArea.appendChild(barLine);
    }

    const col = document.createElement('div');
    col.className = 'tab-col';
    if (inRange(index, selection)) col.classList.add('selected');
    if (playingIndex === index) col.classList.add('playing');
    col.title = DURATION_JA[entry.duration] || '';
    col.tabIndex = 0;
    col.setAttribute('role', 'button');

    const durationRow = document.createElement('div');
    durationRow.className = 'tab-duration-symbol';
    durationRow.textContent = DURATION_SYMBOL[entry.duration] || '';
    col.appendChild(durationRow);

    if (entry.type === 'rest') {
      const restCell = document.createElement('div');
      restCell.className = 'tab-rest-cell';
      restCell.textContent = '休';
      restCell.style.gridRow = `2 / span ${stringCount}`;
      col.appendChild(restCell);
      col.classList.add('tab-col-rest');
    } else {
      const rowOfEntry = tuning.length - 1 - entry.string; // 表示上の行(上=高音弦)
      for (let row = 0; row < stringCount; row++) {
        const cell = document.createElement('div');
        cell.className = 'tab-cell';
        if (row === rowOfEntry) {
          if (entry.type === 'ghost') {
            cell.textContent = '✕';
            cell.classList.add('tab-cell-ghost');
          } else {
            const suffix = entry.articulation ? ARTICULATION_SUFFIX[entry.articulation] || '' : '';
            cell.textContent = `${entry.fret}${suffix}`;
            cell.classList.add('tab-cell-note');
            colorClassesForEntry(entry, tuning, colorSync, key, scale, displayMode).forEach((c) =>
              cell.classList.add(c)
            );
          }
        } else {
          cell.textContent = '－';
          cell.classList.add('tab-cell-empty');
        }
        col.appendChild(cell);
      }
    }

    col.addEventListener('click', (event) => onColumnClick?.(index, event));
    col.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onColumnClick?.(index, event);
      }
    });

    scrollArea.appendChild(col);
  });

  wrapper.appendChild(scrollArea);
  container.replaceChildren(wrapper);
}
