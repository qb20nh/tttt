export type TTFlag = 'exact' | 'lower' | 'upper';

export interface TTEntry {
    depth: number;
    score: number;
    flag: TTFlag;
    bestMove: number;
}

export class TT {
    front: Map<bigint, TTEntry>;
    back: Map<bigint, TTEntry>;
    limit: number;

    constructor(limit = 4194304) { // Limit ~4M per map => ~8M total max (Safe)
        this.front = new Map();
        this.back = new Map();
        this.limit = limit;
    }

    put(hash: bigint, depth: number, score: number, flag: TTFlag, bestMove: number) {
        // Replacement strategy: Depth Priority?
        // For now, we overwrite in front.

        // Check if front is full
        if (this.front.size >= this.limit) {
            // Swap: back becomes the old front
            this.back = this.front;
            this.front = new Map();
        }

        this.front.set(hash, { depth, score, flag, bestMove });
    }

    get(hash: bigint): TTEntry | undefined {
        // Check front first
        let entry = this.front.get(hash);
        if (entry) return entry;

        // Check back
        entry = this.back.get(hash);
        if (entry) {
            // Promote to front (LRU behavior)
            this.front.set(hash, entry);
            this.back.delete(hash);
            return entry;
        }

        return undefined;
    }

    clear() {
        this.front.clear();
        this.back.clear();
    }

    size() {
        return this.front.size + this.back.size;
    }
}

export const tt = new TT();
