import { Search } from './default/search';
import { BoardAdapter } from './default/adapter';
import type { BoardNode, Player } from '../types';
import { CELL_X, CELL_O } from './default/constants';
import { tt } from './default/transposition';
import { getRandomSymmetry, transformBoard, transformConstraint, inverseTransformPath } from './symmetry';
import { isValidPath } from '../logic';

type WorkerMessage =
    | {
        type: 'search';
        board: BoardNode;
        player: Player;
        constraint: number[];
        config: { maxTime: number; maxDepth: number; boardDepth: number; };
    }
    | {
        type: 'benchmark';
        board: BoardNode;
        player: Player;
        constraint: number[];
        config: { maxTime: number; maxDepth: number; boardDepth: number; };
    }
    | { type: 'clear' };

// Global Search Instance
const engine = new Search();

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;

    if (msg.type === 'search') {
        const { board: boardNode, player, constraint, config } = msg;
        try {
            // Apply Random Symmetry
            const symIdx = getRandomSymmetry();

            // Transform Board & Constraint
            const transBoard = transformBoard(boardNode, symIdx);
            const transConstraint = transformConstraint(constraint, symIdx);

            const board = BoardAdapter.toBoard(transBoard, config.boardDepth, transConstraint);
            const pVal = player === 'X' ? CELL_X : CELL_O;

            const result = engine.search(board, pVal, config.maxDepth, config.maxTime);

            // Convert Flat Move to Path
            const bestPath: number[] = [];
            if (result.move !== -1) {
                let m = result.move;
                for (let i = 0; i < config.boardDepth; i++) {
                    bestPath.unshift(m % 9);
                    m = Math.floor(m / 9);
                }
            }

            // Inverse Transform Path
            const finalPath = inverseTransformPath(bestPath, symIdx);

            // Safety Validation: Check if the move is actually legal on the ORIGINAL board
            // We reuse logic from engine (simplified)

            let isValid = true;
            if (finalPath.length === 0) isValid = false;

            // Check constraint
            if (isValid && constraint.length > 0) {
                // Check if path starts with constraint
                for (let i = 0; i < constraint.length; i++) {
                    if (finalPath[i] !== constraint[i]) {
                        isValid = false; break;
                    }
                }
            }

            // Check if path is valid (SSOT)
            if (isValid) {
                isValid = isValidPath(boardNode, finalPath);
            }

            if (!isValid) {
                console.warn(`AI generated invalid move with symmetry ${symIdx}. Path: ${finalPath}. Falling back to Identity Search.`);

                // Fallback: Run Identity Search (no symmetry transform)
                // Clear TT since symmetry-transformed entries are useless for identity search
                tt.clear();

                // Use reduced time since we've already spent time on the first search
                const remainingTime = Math.max(config.maxTime / 2, 1000);
                const board = BoardAdapter.toBoard(boardNode, config.boardDepth, constraint);
                const fallbackResult = engine.search(board, pVal, config.maxDepth, remainingTime);

                const bestPath: number[] = [];
                if (fallbackResult.move !== -1) {
                    let m = fallbackResult.move;
                    for (let i = 0; i < config.boardDepth; i++) {
                        bestPath.unshift(m % 9);
                        m = Math.floor(m / 9);
                    }
                }
                self.postMessage({
                    type: 'result',
                    result: {
                        move: bestPath,
                        score: fallbackResult.score,
                        depth: fallbackResult.depth, // Actual depth achieved
                        nodes: result.nodes + fallbackResult.nodes, // Total nodes from both searches
                        time: 0
                    }
                });
            } else {
                self.postMessage({
                    type: 'result',
                    result: {
                        move: finalPath,
                        score: result.score,
                        depth: result.depth, // Actual depth achieved
                        nodes: result.nodes,
                        time: 0
                    }
                });
            }
        } catch (error) {
            console.error("AI Search Error:", error);
            // Return empty result to unblock engine
            self.postMessage({
                type: 'result',
                result: {
                    move: [],
                    score: 0,
                    depth: 0,
                    nodes: 0,
                    time: 0
                }
            });
        }
    } else if (msg.type === 'benchmark') {
        const { board: boardNode, player, constraint, config } = msg;
        try {
            tt.clear();

            const board = BoardAdapter.toBoard(boardNode, config.boardDepth, constraint);
            const pVal = player === 'X' ? CELL_X : CELL_O;

            const start = performance.now();
            const res = engine.search(board, pVal, config.maxDepth, config.maxTime);
            const end = performance.now();

            const result = {
                default: {
                    time: end - start,
                    nodes: res.nodes,
                    nps: (res.nodes / ((end - start) / 1000)) || 0,
                    depth: config.maxDepth
                }
            };

            console.log("Benchmark Result:", result);
            self.postMessage({ type: 'benchmark_result', result });

        } catch (error) {
            console.error("Benchmark Error:", error);
        }
    } else if (msg.type === 'clear') {
        tt.clear();
    }
};
