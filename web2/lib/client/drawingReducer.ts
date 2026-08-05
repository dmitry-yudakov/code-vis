import type { DrawingMark } from '@/lib/shared/types';

export interface DrawingState {
  marks: DrawingMark[];
  past: DrawingMark[][];
  future: DrawingMark[][];
}

export type DrawingAction =
  | { type: 'reset'; marks: DrawingMark[] }
  | { type: 'add'; mark: DrawingMark }
  | { type: 'replace'; mark: DrawingMark }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_MARKS = 500;
const MAX_HISTORY = 50;

function finiteMark(mark: DrawingMark): boolean {
  const numbers = mark.kind === 'pen'
    ? mark.points.flatMap((point) => [point.x, point.y, point.pressure ?? 0])
    : mark.kind === 'rectangle'
      ? [mark.x, mark.y, mark.width, mark.height]
      : mark.kind === 'arrow'
        ? [mark.start.x, mark.start.y, mark.end.x, mark.end.y]
        : [mark.x, mark.y];
  return numbers.every(Number.isFinite) && (mark.kind !== 'pen' || mark.points.length <= 5_000);
}

function commit(state: DrawingState, marks: DrawingMark[]): DrawingState {
  return { marks, past: [...state.past, state.marks].slice(-MAX_HISTORY), future: [] };
}

export function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case 'reset':
      return { marks: action.marks.filter(finiteMark).slice(0, MAX_MARKS), past: [], future: [] };
    case 'add':
      return !finiteMark(action.mark) || state.marks.length >= MAX_MARKS ? state : commit(state, [...state.marks, action.mark]);
    case 'replace':
      return !finiteMark(action.mark) ? state : { ...state, marks: state.marks.map((mark) => mark.id === action.mark.id ? action.mark : mark) };
    case 'remove':
      return commit(state, state.marks.filter((mark) => mark.id !== action.id));
    case 'clear':
      return state.marks.length ? commit(state, []) : state;
    case 'undo': {
      const previous = state.past.at(-1);
      return previous ? { marks: previous, past: state.past.slice(0, -1), future: [state.marks, ...state.future].slice(0, MAX_HISTORY) } : state;
    }
    case 'redo': {
      const next = state.future[0];
      return next ? { marks: next, past: [...state.past, state.marks].slice(-MAX_HISTORY), future: state.future.slice(1) } : state;
    }
  }
}
