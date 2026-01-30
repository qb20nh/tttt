import type { BoardNode, Player, Winner, GameMode } from './types';
import { DEPTH } from './constants';
import { checkWin } from './logic';

const KEY = 'ttt_fractal_state';

interface SavedState {
    board: BoardNode;
    currentPlayer: Player;
    activeConstraint: number[];
    winner: Winner;
    gameMode: GameMode;
}

// 1. Flatten Board
function flattenBoard(node: BoardNode): (Player | null)[] {
    if (!node.children) {
        return [node.value];
    }
    return node.children.flatMap(flattenBoard);
}

// 2. Compact (2 bits per cell)
// 00: null, 01: X, 10: O, 11: unused
function compactBoard(flat: (Player | null)[]): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(flat.length / 4));
    for (let i = 0; i < flat.length; i++) {
        const val = flat[i];
        let bits = 0;
        if (val === 'X') bits = 1; // 01
        else if (val === 'O') bits = 2; // 10
        // else 00

        const byteIdx = Math.floor(i / 4);
        const shift = (3 - (i % 4)) * 2; // Big-endian packing within byte
        bytes[byteIdx] |= (bits << shift);
    }
    return bytes;
}

// 3. Compress (RLE)
// Format: [count, byte]
function compressRLE(data: Uint8Array): Uint8Array {
    const result: number[] = [];
    if (data.length === 0) return new Uint8Array(0);

    let currentByte = data[0];
    let count = 1;

    for (let i = 1; i < data.length; i++) {
        if (data[i] === currentByte && count < 255) {
            count++;
        } else {
            result.push(count);
            result.push(currentByte);
            currentByte = data[i];
            count = 1;
        }
    }
    result.push(count);
    result.push(currentByte);

    return new Uint8Array(result);
}

// Helpers for Reconstruction
function uncompressRLE(data: Uint8Array, originalSize: number): Uint8Array {
    const result = new Uint8Array(originalSize);
    let writeIdx = 0;
    for (let i = 0; i < data.length; i += 2) {
        const count = data[i];
        const byte = data[i + 1];
        if (writeIdx + count > originalSize) break; // Safety
        result.fill(byte, writeIdx, writeIdx + count);
        writeIdx += count;
    }
    return result;
}

function uncompactBoard(packed: Uint8Array, totalCells: number): (Player | null)[] {
    const flat: (Player | null)[] = [];
    for (let i = 0; i < totalCells; i++) {
        const byteIdx = Math.floor(i / 4);
        const shift = (3 - (i % 4)) * 2;
        const byte = packed[byteIdx];
        const bits = (byte >> shift) & 0x03;

        if (bits === 1) flat.push('X');
        else if (bits === 2) flat.push('O');
        else flat.push(null);
    }
    return flat;
}

function reconstructBoard(flat: (Player | null)[], depth: number): { node: BoardNode, taken: number } {
    if (depth === 0) {
        // Leaf
        const val = flat[0];
        return {
            node: {
                winner: null,
                winPattern: -1,
                value: val,
                children: null
            },
            taken: 1
        };
    }

    const children: BoardNode[] = [];
    let totalTaken = 0;
    for (let i = 0; i < 9; i++) {
        const res = reconstructBoard(flat.slice(totalTaken), depth - 1);
        children.push(res.node);
        totalTaken += res.taken;
    }

    // Since we only stored leaves, we need to re-calculate winners/values up the tree
    // Ideally the engine does this, but we need to restore state.
    // We can run a "revalidate" pass.
    let node: BoardNode = {
        winner: null,
        winPattern: -1,
        value: null,
        children
    };

    // Check win for this node
    const winRes = checkWin(children);
    if (winRes) {
        node.winner = winRes.winner;
        node.winPattern = winRes.pattern;
    }

    // Logic Note: The original engine might have more complex state (like 'value' being set on non-leaves if full?)
    // In this game, usually only leaves have 'value' (X/O) and parents have 'winner'.
    // However, if a board is drawn/full, it might need handling?
    // The current `logic.ts` checkWin handles winners. `isFull` handles draws but doesn't set a property.
    // So re-running checkWin is sufficient.

    return { node, taken: totalTaken };
}


export function saveGameState(state: SavedState) {
    try {
        const flat = flattenBoard(state.board);
        const compacted = compactBoard(flat);
        const compressed = compressRLE(compacted);

        // Header format per byte:
        // 0: Player (0=X, 1=O)
        // 1: Constraint Length
        // 2..N: Constraint indices
        // Next: Board Data as raw string

        const header: number[] = [];
        header.push(state.currentPlayer === 'X' ? 0 : 1);

        // Mode mapping: PvP=0, PvAI=1, AIvAI=2
        let modeByte = 1; // Default PvAI
        if (state.gameMode === 'PvP') modeByte = 0;
        else if (state.gameMode === 'AIvAI') modeByte = 2;
        header.push(modeByte);

        header.push(state.activeConstraint.length);
        state.activeConstraint.forEach(c => header.push(c));

        // Convert to binary string
        let binaryString = "";
        // Header
        header.forEach(b => binaryString += String.fromCharCode(b));
        // Separator logic? No need, fixed header structure if we know length.
        // But constraint length varies.

        // Body
        for (let i = 0; i < compressed.length; i++) {
            binaryString += String.fromCharCode(compressed[i]);
        }

        localStorage.setItem(KEY, binaryString);
        // console.log(`Saved: ${compressed.length} bytes (orig ${compacted.length})`);
    } catch (e) {
        console.error("Failed to save state", e);
    }
}

export function loadGameState(): SavedState | null {
    try {
        const data = localStorage.getItem(KEY);
        if (!data) return null;

        let ptr = 0;

        const playerByte = data.charCodeAt(ptr++);
        const currentPlayer: Player = playerByte === 0 ? 'X' : 'O';

        const modeByte = data.charCodeAt(ptr++);
        let gameMode: GameMode = 'PvAI';
        if (modeByte === 0) gameMode = 'PvP';
        else if (modeByte === 2) gameMode = 'AIvAI';

        const constraintLen = data.charCodeAt(ptr++);
        const activeConstraint: number[] = [];
        for (let i = 0; i < constraintLen; i++) {
            activeConstraint.push(data.charCodeAt(ptr++));
        }

        const bodyString = data.slice(ptr);
        const bodyBytes = new Uint8Array(bodyString.length);
        for (let i = 0; i < bodyString.length; i++) {
            bodyBytes[i] = bodyString.charCodeAt(i);
        }

        // Decompress
        // We need to know original compacted size? 
        // 9^4 cells = 6561. 
        // 4 cells per byte -> ceil(6561/4) = 1641 bytes.
        const TOTAL_CELLS = Math.pow(9, DEPTH); // 6561
        const COMPACT_SIZE = Math.ceil(TOTAL_CELLS / 4);

        const compacted = uncompressRLE(bodyBytes, COMPACT_SIZE);
        const flat = uncompactBoard(compacted, TOTAL_CELLS);
        const { node } = reconstructBoard(flat, DEPTH);

        // Re-verify winners from bottom up?
        // reconstructBoard already does checkWin recursively.

        // Also restore winner if root is won
        const rootRes = checkWin(node.children!);
        const winner = rootRes ? rootRes.winner : null;
        if (winner) {
            node.winner = winner;
            node.winPattern = rootRes!.pattern;
        }

        return {
            board: node,
            currentPlayer,
            activeConstraint,
            winner,
            gameMode
        };
    } catch (e) {
        console.error("Failed to load state", e);
        return null;
    }
}

export function clearSavedState() {
    localStorage.removeItem(KEY);
}
