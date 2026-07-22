// SVGによるフレットボード描画

import { NOTE_NAMES, noteAtFret } from './notes.js';
import { isInScale, isRootNote } from './scales.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LABEL_WIDTH = 60; // 開放弦の音名ラベル用の幅
const OPEN_COL_WIDTH = 50; // 開放弦(0フレット)マーカー用の幅
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 34;
const ROW_HEIGHT = 46;
const NOTE_RADIUS = 15;
const MUTED_RADIUS = 9;
const MIN_WIDTH = 480;

function createSvgElement(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} container
 * @param {{tuning: {name:string, octave:number}[], fretCount: number, key: string, scale: string}} state
 * @param {{onNoteClick?: (stringIndex:number, fret:number, note:{name:string, octave:number}) => void}} [callbacks]
 */
export function renderFretboard(container, state, { onNoteClick } = {}) {
  const { tuning, fretCount, key, scale } = state;
  const rootIndex = NOTE_NAMES.indexOf(key);

  // 表示上は高音弦を上、低音弦を下にする
  const displayStrings = [...tuning].reverse();
  const stringCount = displayStrings.length;

  const width = Math.max(container.clientWidth || 0, MIN_WIDTH);
  const marginLeft = LABEL_WIDTH + OPEN_COL_WIDTH;
  const boardWidth = Math.max(width - marginLeft - MARGIN_RIGHT, fretCount * 20);
  const colWidth = boardWidth / fretCount;
  const height = MARGIN_TOP + (stringCount - 1) * ROW_HEIGHT + MARGIN_BOTTOM + 20;

  const nutX = marginLeft;
  const openX = LABEL_WIDTH + OPEN_COL_WIDTH / 2;
  const wireX = (fretIndex) => nutX + fretIndex * colWidth;
  const fretCenterX = (fret) => nutX + (fret - 1) * colWidth + colWidth / 2;
  const stringY = (rowIndex) => MARGIN_TOP + rowIndex * ROW_HEIGHT;

  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    role: 'img',
    'aria-label': 'フレットボード',
  });

  const topY = MARGIN_TOP;
  const bottomY = stringY(stringCount - 1);

  // フレットワイヤー(縦線)
  for (let fret = 1; fret <= fretCount; fret++) {
    svg.appendChild(
      createSvgElement('line', {
        x1: wireX(fret), y1: topY - 12, x2: wireX(fret), y2: bottomY + 12,
        class: 'fret-wire',
      })
    );
  }

  // ナット(0フレットの境界)
  svg.appendChild(
    createSvgElement('line', {
      x1: nutX, y1: topY - 14, x2: nutX, y2: bottomY + 14,
      class: 'nut',
    })
  );

  // フレット番号
  for (let fret = 1; fret <= fretCount; fret++) {
    svg.appendChild(
      createSvgElement('text', {
        x: fretCenterX(fret), y: bottomY + MARGIN_BOTTOM,
        class: 'fret-number', 'text-anchor': 'middle',
      }, String(fret))
    );
  }
  svg.appendChild(
    createSvgElement('text', {
      x: openX, y: bottomY + MARGIN_BOTTOM,
      class: 'fret-number', 'text-anchor': 'middle',
    }, '開放')
  );

  displayStrings.forEach((openNote, rowIndex) => {
    const y = stringY(rowIndex);
    const originalIndex = tuning.length - 1 - rowIndex;

    // 弦(横線)
    svg.appendChild(
      createSvgElement('line', {
        x1: LABEL_WIDTH - 10, y1: y, x2: wireX(fretCount), y2: y,
        class: 'string-line',
      })
    );

    // 開放弦の音名ラベル
    svg.appendChild(
      createSvgElement('text', {
        x: LABEL_WIDTH - 18, y: y + 5,
        class: 'string-label', 'text-anchor': 'end',
      }, `${openNote.name}${openNote.octave}`)
    );

    for (let fret = 0; fret <= fretCount; fret++) {
      const note = noteAtFret(openNote.name, openNote.octave, fret);
      const noteIndex = NOTE_NAMES.indexOf(note.name);
      const root = isRootNote(noteIndex, rootIndex);
      const inScale = isInScale(noteIndex, rootIndex, scale);
      const x = fret === 0 ? openX : fretCenterX(fret);

      const group = createSvgElement('g', {
        class: 'note-cell',
        tabindex: '0',
        role: 'button',
        'aria-label': `${note.name}${note.octave} を再生`,
      });

      const highlighted = root || inScale;
      const radius = highlighted ? NOTE_RADIUS : MUTED_RADIUS;
      const circleClass = root ? 'note-circle root' : inScale ? 'note-circle in-scale' : 'note-circle muted';
      const textClass = highlighted ? 'note-text' : 'note-text muted';

      group.appendChild(createSvgElement('circle', { cx: x, cy: y, r: radius, class: circleClass }));
      group.appendChild(
        createSvgElement('text', { x, y: y + 4, class: textClass, 'text-anchor': 'middle' }, note.name)
      );

      const handleActivate = () => onNoteClick?.(originalIndex, fret, note);
      group.addEventListener('click', handleActivate);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate();
        }
      });

      svg.appendChild(group);
    }
  });

  container.replaceChildren(svg);
}
