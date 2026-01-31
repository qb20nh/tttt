import type { BoardNode, Player } from '../types';
import type { TranspositionEntry } from './types';

// Zobrist keys
// Level 0-3 (4 levels), 9 positions per level.
// We need unique keys for each cell at each level being X or O.
// Max depth 4. Total cells = 9 + 81 + 729 + 6561... actually we can just hash by path.
// But recursive hashing is cleaner.

const TABLE_SIZE = 4; // levels
const POSITIONS = 9;
const PLAYERS = 2; // X and O

// Random bigints
const ZOBRIST = {
    // [level][position][player_index]
    pieces: Array(TABLE_SIZE).fill(null).map(() =>
        Array(POSITIONS).fill(null).map(() =>
            Array(PLAYERS).fill(null).map(() => BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)))
        )
    ),
    sideToMove: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
};

export class TranspositionTable {
    private table: Map<bigint, TranspositionEntry>;

    constructor() {
        this.table = new Map();
    }

    get(hash: bigint): TranspositionEntry | undefined {
        return this.table.get(hash);
    }

    put(hash: bigint, entry: TranspositionEntry) {
        this.table.set(hash, entry);
    }

    computeHash(board: BoardNode, level: number = 0): bigint {
        let h = 0n;
        if (board.children) {
            for (let i = 0; i < 9; i++) {
                h ^= this.computeHash(board.children[i], level + 1);
            }
        }

        // Also hash the local state (winner/value) if it's not a leaf (redundant if checking children? No, cached winners)
        // Actually, easiest is to just hash the leaf values and derive up?
        // But internal nodes have state 'winner'.
        // Let's simplified: Hash the leaf values.

        if (board.value === 'X') {
            // Use level 3 (leaf level) keys? Or current level?
            // Since the structure is fixed, we can just use a stream of keys?
            // No, standard Zobrist is usually (piece, square).
            // Here "square" is the path.
            // Let's use a simpler recursive approach. 
            // mix(hash(child), child_index)
        }

        return h; // Placeholder, see computeHashRecursive
    }

    // Better approach: stateless hash computation is expensive. 
    // Ideally we update hash incrementally. But for now, full computation is safer.

    // We will use a simplified hash for now: recursively XORing hashes of children.
    // At leaves, we use random keys.
    // At internal nodes, we mix child hashes.

}

// Actually, implementing a full Zobrist for this fractal board is tricky without 
// pre-generating 6561 keys or mixing.
// Let's use a mixing function.

function mix(h: bigint): bigint {
    h ^= h >> 33n;
    h *= 0xff51afd7ed558ccdn;
    h ^= h >> 33n;
    h *= 0xc4ceb9fe1a85ec53n;
    h ^= h >> 33n;
    return h;
}

const PLAYER_KEYS: Record<string, bigint> = {
    'X': 0x1234567890ABCDEFn,
    'O': 0xFEDCBA0987654321n,
    'Draw': 0xAAAA5555AAAA5555n
};

export const computeHash = (board: BoardNode, turn: Player, constraint: number[]): bigint => {
    let h = hashNode(board);
    if (turn === 'O') h ^= ZOBRIST.sideToMove;

    // Hash constraint
    for (let i = 0; i < constraint.length; i++) {
        const val = constraint[i] + 1; // 1-9
        // Shift and mix for each constraint level
        let ch = BigInt(val);
        ch = mix(ch ^ BigInt(i + 100)); // distinct from board position mixing
        h ^= ch;
    }

    return h;
}

function hashNode(node: BoardNode): bigint {
    if (node.value) {
        return mix(PLAYER_KEYS[node.value]);
    }
    if (node.winner) {
        // Optimization: if a node is won, we treat it like a leaf? 
        // But game state might still track children?
        // In Fractal TTT, if a node is won, its children don't matter for the win-check of parent.
        // So yes, we can treat it as a leaf.
        return mix(PLAYER_KEYS[node.winner]);
    }

    let h = 0n;
    if (node.children) {
        for (let i = 0; i < 9; i++) {
            let childH = hashNode(node.children[i]);
            // Rotate or mix based on position i to distinguish permutations
            childH = mix(childH ^ BigInt(i + 1));
            h ^= childH;
        }
    }
    return h;
}

export const tt = new Map<bigint, TranspositionEntry>();
