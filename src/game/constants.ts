// --- Game Logic Constants ---
export const DEFAULT_DEPTH = 2
export const MAX_DEPTH = 4
export const WIN_PATTERNS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

// AI search depth based on board depth (Single Source of Truth)
export const getSearchDepth = (boardDepth: number): number => {
  if (boardDepth === 4) return 12
  return 14
}

// --- Constants for Layout ---
export const BASE_GAP = 0.000625
export const OUTER_GAP = 5.0 * BASE_GAP
export const BOARD_SIZE = 81
