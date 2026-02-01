import { Board } from './board';
import { MoveGen } from './movegen';
import { CELL_EMPTY, CELL_X, CELL_O } from './constants';
import { tt } from './transposition';
import { ZOBRIST_SIDE, ZOBRIST_CONSTRAINT } from './zobrist';

// Global Move Stack (Pre-allocated)
const MOVE_STACK = new Int32Array(50000);

export class Search {
    nodesVisited = 0;
    startTime = 0;
    timeLimit = 1000;
    abort = false;

    search(board: Board, player: number, maxDepth: number, timeout: number): { move: number, score: number, nodes: number, depth: number } {
        this.nodesVisited = 0;
        this.startTime = performance.now();
        this.timeLimit = timeout;
        this.abort = false;

        // First Move Optimization: On empty board for D>=3, all positions are equivalent
        // Return random move immediately to save compute time (D=2 is small enough to search)
        if (board.depth >= 3 && this.isBoardEmpty(board)) {
            const totalCells = board.leaves.length;
            const randomMove = Math.floor(Math.random() * totalCells);
            return { move: randomMove, score: 0, nodes: 0, depth: 0 };
        }

        let bestScore = -Infinity;
        let bestMove = -1;
        let completedDepth = 0;

        // Iterative Deepening
        for (let d = 1; d <= maxDepth; d++) {
            // Guarantee completion of Depth 1 by disabling timeout abort
            const canAbort = d > 1;
            const result = this.alphaBeta(board, player, d, -Infinity, Infinity, 0, canAbort);

            if (this.abort) break;

            bestScore = result.score;
            bestMove = result.move;
            completedDepth = d;

            if (result.score > 90000) break;
        }

        // Final Safety Check: If we somehow still have -1 (e.g. empty board loop?), try to find something.
        // But D=1 guarantee should fix 99% of cases.
        if (bestMove === -1) {
            // Fallback: Just return ANY valid move if we have nothing.
            // This prevents "No move" error.
            const count = MoveGen.generate(board, MOVE_STACK, 0);
            if (count > 0) {
                // Pick random to avoid bias
                const randIdx = Math.floor(Math.random() * count);
                bestMove = MOVE_STACK[randIdx];
            }
        }

        return { move: bestMove, score: bestScore, nodes: this.nodesVisited, depth: completedDepth };
    }

    // Check if board is completely empty (all leaves are CELL_EMPTY)
    private isBoardEmpty(board: Board): boolean {
        for (let i = 0; i < board.leaves.length; i++) {
            if (board.leaves[i] !== CELL_EMPTY) return false;
        }
        return true;
    }

    alphaBeta(
        board: Board,
        player: number,
        depth: number,
        alpha: number,
        beta: number,
        stackOffset: number,
        canAbort: boolean
    ): { score: number, move: number } {

        this.nodesVisited++;
        if (canAbort && (this.nodesVisited & 65535) === 0) {
            if (performance.now() - this.startTime > this.timeLimit) {
                this.abort = true;
            }
        }
        if (this.abort) return { score: 0, move: -1 };

        // TT Lookup
        let currentHash = board.hash;
        if (player === CELL_O) currentHash ^= ZOBRIST_SIDE;

        // Use proper Zobrist for constraint
        // Constraint range: -1 (free) to 729 (9^3 for D=4), so +1 gives 0-730
        // Mask to 0-1023 ensures safe array indexing (ZOBRIST_CONSTRAINT has 1024 entries)
        const constraintIdx = ((board.constraint + 1) & 1023);
        currentHash ^= ZOBRIST_CONSTRAINT[constraintIdx];

        const ttEntry = tt.get(currentHash);
        if (ttEntry && ttEntry.depth >= depth) {
            if (ttEntry.flag === 'exact') return { score: ttEntry.score, move: ttEntry.bestMove };
            if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
            if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
            if (alpha >= beta) return { score: ttEntry.score, move: ttEntry.bestMove };
        }

        const originalAlpha = alpha;

        const winner = board.getWinner();
        if (winner !== 0) {
            if (winner === player) return { score: 100000 + depth, move: -1 };
            if (winner === (player === CELL_X ? CELL_O : CELL_X)) return { score: -100000 - depth, move: -1 };
            return { score: 0, move: -1 };
        }

        if (depth === 0) {
            return { score: board.evaluate(player), move: -1 };
        }

        const count = MoveGen.generate(board, MOVE_STACK, stackOffset);

        if (count === 0) {
            return { score: board.evaluate(player), move: -1 };
        }

        // Move Ordering: TT Move First
        if (ttEntry && ttEntry.bestMove !== -1) {
            for (let i = 0; i < count; i++) {
                if (MOVE_STACK[stackOffset + i] === ttEntry.bestMove) {
                    const temp = MOVE_STACK[stackOffset];
                    MOVE_STACK[stackOffset] = MOVE_STACK[stackOffset + i];
                    MOVE_STACK[stackOffset + i] = temp;
                    break;
                }
            }
        }

        let bestScore = -Infinity;
        let bestMove = -1;

        const opponent = player === CELL_X ? CELL_O : CELL_X;
        const oldConstraint = board.constraint;
        const oldLayer = board.constraintLayer;

        for (let i = 0; i < count; i++) {
            const move = MOVE_STACK[stackOffset + i];

            // Apply Move
            const changedLevel = board.setCell(move, player);

            // Update Constraint
            const D = board.depth;
            const targetLayer = (changedLevel === -1) ? (D - 1) : (changedLevel - 1);

            if (targetLayer < 0) {
                board.constraint = -1;
                board.constraintLayer = -1;
            } else {
                const power = D - 1 - targetLayer;
                let scale = 1;
                for (let k = 0; k < power; k++) scale *= 9;

                const parentScale = scale * 9;
                const context = Math.floor(move / parentScale);
                const relMove = Math.floor(move / scale) % 9;

                board.constraint = context * 9 + relMove;
                board.constraintLayer = targetLayer;
            }

            const result = this.alphaBeta(board, opponent, depth - 1, -beta, -alpha, stackOffset + count, canAbort);
            const score = -result.score;

            // Revert
            board.setCell(move, CELL_EMPTY);
            board.constraint = oldConstraint;
            board.constraintLayer = oldLayer;

            if (this.abort) return { score: 0, move: -1 };

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
            if (score > alpha) {
                alpha = score;
                bestMove = move;
            }
            if (alpha >= beta) break;
        }

        // TT Store
        let flag: 'exact' | 'lower' | 'upper' = 'exact';
        if (bestScore <= originalAlpha) flag = 'upper';
        else if (bestScore >= beta) flag = 'lower';

        tt.put(currentHash, depth, bestScore, flag, bestMove);

        return { score: bestScore, move: bestMove };
    }
}
