export const CELL_EMPTY = 0;
export const CELL_X = 1;
export const CELL_O = 2;
export const CELL_DRAW = 3; // Used for "Won by Draw" in higher layers

export type CellValue = 0 | 1 | 2 | 3;

// Mapping legacy Player string to integer
export const PLAYER_X_VAL = 1;
export const PLAYER_O_VAL = 2;

export const WIN_PATTERNS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
    [0, 4, 8], [2, 4, 6]             // Diagonals
];
