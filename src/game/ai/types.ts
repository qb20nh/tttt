

export interface AIConfig {
    maxTime: number;
    maxDepth: number;
    debug?: boolean;
}

export interface SearchResult {
    move: number[]; // Path to the move [p0, p1, p2, p3]
    score: number;
    depth: number;
    nodes: number;
    time: number;
}

export interface TranspositionEntry {
    depth: number;
    score: number;
    flag: 'exact' | 'lower' | 'upper';
    bestMove: number[] | null;
}

export const SCORE_WIN = 100000;
export const SCORE_LOSS = -100000;
export const SCORE_MATE = 90000;
