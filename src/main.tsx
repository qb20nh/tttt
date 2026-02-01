import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Global benchmark function - always available
import { Search } from './game/ai/default/search'
import { BoardAdapter } from './game/ai/default/adapter'
import { generateBoard } from './game/logic'
import { getSearchDepth } from './game/constants'
import { tt } from './game/ai/default/transposition'
import { CELL_O } from './game/ai/default/constants'

declare global {
  interface Window {
    runAiBenchmark: (depth?: number, time?: number) => void;
  }
}

const benchmarkEngine = new Search();

window.runAiBenchmark = (boardDepth = 4, timeMs = 2000) => {
  console.log(`Starting ${timeMs}ms Benchmark on D=${boardDepth} board...`);

  tt.clear();

  const boardNode = generateBoard(boardDepth);

  // Make one random first move so we have a non-empty board to search
  const totalCells = Math.pow(9, boardDepth);
  const randomCell = Math.floor(Math.random() * totalCells);

  // Navigate to leaf and set value
  let node = boardNode;
  const path: number[] = [];
  let m = randomCell;
  for (let i = 0; i < boardDepth; i++) {
    path.unshift(m % 9);
    m = Math.floor(m / 9);
  }
  for (let i = 0; i < boardDepth - 1; i++) {
    node = node.children![path[i]];
  }
  node.children![path[boardDepth - 1]].value = 'X';

  // Constraint from the move
  const constraint = path.slice(1);

  const board = BoardAdapter.toBoard(boardNode, boardDepth, constraint);

  const maxSearchDepth = getSearchDepth(boardDepth);

  const start = performance.now();
  const result = benchmarkEngine.search(board, CELL_O, maxSearchDepth, timeMs);
  const end = performance.now();

  const elapsed = end - start;
  const nps = result.nodes > 0 ? result.nodes / (elapsed / 1000) : 0;

  console.table({
    'Board Depth': boardDepth,
    'Max Search Depth': maxSearchDepth,
    'Actual Depth Explored': result.depth,
    'Time (ms)': Math.round(elapsed),
    'Nodes': result.nodes.toLocaleString(),
    'NPS': Math.round(nps).toLocaleString(),
    'Best Score': result.score,
    'Note': result.depth === 0 ? 'Empty board - random first move' : ''
  });

  if (result.depth === 0) {
    console.log('Empty board detected - returned random first move');
  }

  alert(`Benchmark Complete!\nDepth: ${result.depth}/${maxSearchDepth}\nNPS: ${Math.round(nps).toLocaleString()}\nNodes: ${result.nodes.toLocaleString()}\nTime: ${Math.round(elapsed)}ms`);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
