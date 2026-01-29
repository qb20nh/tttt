// Game primitives
export type Player = 'X' | 'O';
export type Winner = Player | null;

// The fractal board structure
export interface BoardNode {
    winner: Winner;
    winPattern: number;
    value: Winner;
    children?: BoardNode[] | null;
}

// Geometric types
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
