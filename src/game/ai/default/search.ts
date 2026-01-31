import { Board } from './board';
import { MoveGen } from './movegen';
import { CELL_EMPTY, CELL_X, CELL_O } from './constants';
import { tt } from './transposition';
import { ZOBRIST_SIDE } from './zobrist';

// Global Move Stack (Pre-allocated)
const MOVE_STACK = new Int32Array(50000);

export class Search {
    nodesVisited = 0;
    startTime = 0;
    timeLimit = 1000;
    abort = false;

    search(board: Board, player: number, maxDepth: number, timeout: number): { move: number, score: number, nodes: number } {
        this.nodesVisited = 0;
        this.startTime = performance.now();
        this.timeLimit = timeout;
        this.abort = false;

        let bestScore = -Infinity;
        let bestMove = -1;

        // Iterative Deepening
        for (let d = 1; d <= maxDepth; d++) {
            const result = this.alphaBeta(board, player, d, -Infinity, Infinity, 0);

            if (this.abort) break;

            bestScore = result.score;
            bestMove = result.move;

            if (result.score > 90000) break;
        }

        return { move: bestMove, score: bestScore, nodes: this.nodesVisited };
    }

    alphaBeta(
        board: Board,
        player: number,
        depth: number,
        alpha: number,
        beta: number,
        stackOffset: number
    ): { score: number, move: number } {

        this.nodesVisited++;
        if ((this.nodesVisited & 4095) === 0) {
            if (performance.now() - this.startTime > this.timeLimit) {
                this.abort = true;
            }
        }
        if (this.abort) return { score: 0, move: -1 };

        // TT Lookup
        let currentHash = board.hash;
        if (player === CELL_O) currentHash ^= ZOBRIST_SIDE;

        currentHash ^= BigInt(board.constraint + 2);

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

            const result = this.alphaBeta(board, opponent, depth - 1, -beta, -alpha, stackOffset + count);
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
