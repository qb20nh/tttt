
export type TTFlag = 'exact' | 'lower' | 'upper';

export interface TTEntry {
    depth: number;
    score: number;
    flag: TTFlag;
    bestMove: number;
}

// 2M entries = 32MB RAM per Worker (16MB Keys + 16MB Values)
const TABLE_SIZE = 2 * 1024 * 1024;

export class TT {
    // Key: Full Zobrist Hash
    keys: BigUint64Array;

    // Value: Packed Data
    // [i*2 + 0]: Score (Int32)
    // [i*2 + 1]: Packed (Int32) -> [Move: 16 | Depth: 8 | Flag: 2]
    values: Int32Array;

    mask: bigint;

    constructor(size = TABLE_SIZE) {
        // Ensure power of 2
        let realSize = 1;
        while (realSize < size) realSize *= 2;

        this.keys = new BigUint64Array(realSize);
        this.values = new Int32Array(realSize * 2);
        this.mask = BigInt(realSize - 1);
    }

    put(hash: bigint, depth: number, score: number, flag: TTFlag, bestMove: number) {
        const index = Number(hash & this.mask);

        // Replacement Strategy: 
        // If current entry is empty (key=0), replace.
        // If exact hash match (update), replace.
        // If new result has deeper search, replace.
        // Else, keep existing (Depth-Preferred).

        const existingKey = this.keys[index];

        if (existingKey !== 0n) {
            // Check depth for both Collision and Same-Key updates
            const existingPacked = this.values[index * 2 + 1];
            const existingDepth = (existingPacked >> 2) & 0xFF;

            // If new depth is lower, keep the existing deeper result
            if (depth < existingDepth) {
                return;
            }

            // If depths are equal, we generally overwrite (prefer new)
            // But for collisions, some engines prefer to keep old.
            // Here we simply overwrite if depth >= existing.
        }

        // Write
        this.keys[index] = hash;
        this.values[index * 2] = score;

        let flagVal = 0;
        if (flag === 'lower') flagVal = 1;
        else if (flag === 'upper') flagVal = 2;

        // Move: 16 bits (0-65535)
        // Depth: 8 bits (0-255)
        // Flag: 2 bits (0-3)
        // Layout: [Move << 10] | [Depth << 2] | [Flag]

        // Safety clamp
        const safeMove = bestMove === -1 ? 65535 : bestMove;

        const packed = (safeMove << 10) | (depth << 2) | flagVal;
        this.values[index * 2 + 1] = packed;
    }

    get(hash: bigint): TTEntry | undefined {
        const index = Number(hash & this.mask);

        // Check Key
        if (this.keys[index] !== hash) return undefined;

        const score = this.values[index * 2];
        const packed = this.values[index * 2 + 1];

        const flagVal = packed & 3;
        const depth = (packed >> 2) & 0xFF;
        const moveRaw = (packed >> 10) & 0xFFFF;

        // Restore move
        const bestMove = moveRaw === 65535 ? -1 : moveRaw;

        let flag: TTFlag = 'exact';
        if (flagVal === 1) flag = 'lower';
        else if (flagVal === 2) flag = 'upper';

        return { depth, score, flag, bestMove };
    }

    clear() {
        this.keys.fill(0n);
        this.values.fill(0);
    }

    size() {
        // Approximate count? Or just capacity?
        return this.keys.length;
    }
}

export const tt = new TT();
