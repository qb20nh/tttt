export const CELL_EMPTY = 0
export const CELL_X = 1
export const CELL_O = 2
export const CELL_DRAW = 3 // Used for "Won by Draw" in higher layers

export type CellValue = 0 | 1 | 2 | 3

// Mapping legacy Player string to integer
export const PLAYER_X_VAL = 1
export const PLAYER_O_VAL = 2

export { WIN_PATTERNS } from '../../constants'
