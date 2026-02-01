import { CELL_EMPTY, CELL_X, CELL_O, CELL_DRAW, WIN_PATTERNS } from './constants';

export const TABLE_SIZE = 19683; // 3^9

// Powers of 4 precomputed
export const POW4 = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536];

export const LUT_WIN_STATUS_BASE4 = new Uint8Array(262144);
export const LUT_SCORE_BASE4 = new Int16Array(262144);

export const SCORE_WIN = 1000;
export const SCORE_NEAR_X = 100; // 2 in row for X
export const SCORE_NEAR_O = -100; // 2 in row for O
export const SCORE_ADV_X = 10;
export const SCORE_ADV_O = -10;

let initialized = false;

export function initTables() {
    if (initialized) return;

    const cells = new Int8Array(9);

    for (let i = 0; i < 262144; i++) {
        // Decode i to cells
        let temp = i;
        let emptyCount = 0;

        for (let j = 0; j < 9; j++) {
            const val = temp % 4;
            cells[j] = val;
            temp = Math.floor(temp / 4);

            if (val === CELL_EMPTY) emptyCount++;
        }

        // Determine Winner
        let winner = 0; // 0=None/Playing

        for (const [a, b, c] of WIN_PATTERNS) {
            const va = cells[a];
            const vb = cells[b];
            const vc = cells[c];

            if (va !== CELL_EMPTY && va !== CELL_DRAW && va === vb && vb === vc) {
                winner = va;
                break;
            }
        }

        // If no winner, check full/draw
        if (winner === 0 && emptyCount === 0) {
            winner = CELL_DRAW;
        }

        LUT_WIN_STATUS_BASE4[i] = winner;

        // Calculate Heuristic Score (from X perspective)
        let score = 0;
        if (winner === CELL_X) score = SCORE_WIN;
        else if (winner === CELL_O) score = -SCORE_WIN;
        else if (winner === CELL_DRAW) score = 0; // Neutral
        else {
            // Evaluator logic roughly
            for (const [a, b, c] of WIN_PATTERNS) {
                const vals = [cells[a], cells[b], cells[c]];
                let cx = 0, co = 0;
                for (const v of vals) {
                    if (v === CELL_X) cx++;
                    if (v === CELL_O) co++;
                }

                // 2-in-row (cx=2, co=0) -> Threat
                if (cx === 2 && co === 0) score += SCORE_NEAR_X;
                else if (co === 2 && cx === 0) score += SCORE_NEAR_O;
                else if (cx === 1 && co === 0) score += SCORE_ADV_X;
                else if (co === 1 && cx === 0) score += SCORE_ADV_O;
            }

            // Positional Bonuses
            // Center (4)
            const cVal = cells[4];
            if (cVal === CELL_X) score += 5;
            else if (cVal === CELL_O) score -= 5;

            // Corners (0, 2, 6, 8)
            for (const idx of [0, 2, 6, 8]) {
                const val = cells[idx];
                if (val === CELL_X) score += 2;
                else if (val === CELL_O) score -= 2;
            }
        }

        LUT_SCORE_BASE4[i] = score;
    }

    initialized = true;
}
