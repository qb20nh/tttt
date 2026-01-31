export type TTFlag = 'exact' | 'lower' | 'upper';

export interface TTEntry {
    depth: number;
    score: number;
    flag: TTFlag;
    bestMove: number;
}

export class TT {
    table: Map<bigint, TTEntry>;

    constructor() {
        this.table = new Map();
    }

    put(hash: bigint, depth: number, score: number, flag: TTFlag, bestMove: number) {
        // Replacement strategy: Always replace?
        // Or prefer deeper entries?

        // const existing = this.table.get(hash);
        // if (existing && existing.depth > depth) return; // Keep deeper

        // For TTT, simple replace is often fine or "Depth Priority"
        this.table.set(hash, { depth, score, flag, bestMove });
    }

    get(hash: bigint): TTEntry | undefined {
        return this.table.get(hash);
    }

    clear() {
        this.table.clear();
    }

    size() {
        return this.table.size;
    }
}

export const tt = new TT();
