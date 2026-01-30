import type { BoardNode, Player } from '../types';
import { calculateNextConstraint, isPlayable, applyMove, undoMove } from './boardUtils';
import { generateMoves } from './moveGen';
import { evaluate } from './evaluator';
// import { tt, computeHash } from './transposition';
import type { AIConfig, SearchResult } from './types';
import { SCORE_WIN } from './types';

let nodesVisited = 0;
let searchStartTime = 0;
let timeLimit = 0;
let abortSearch = false;

export function search(board: BoardNode, player: Player, constraint: number[], config: AIConfig): SearchResult {
    nodesVisited = 0;
    searchStartTime = performance.now();
    timeLimit = config.maxTime;
    abortSearch = false;

    let bestMove: number[] | null = null;
    let bestScore = -Infinity;

    // Iterative Deepening
    // For fractal TTT, depth 1 is minimal.
    // We aim for depth 2 or 3.
    // Depth 4 is full game lookahead (optimistic).

    for (let d = 1; d <= config.maxDepth; d++) {
        const result = alphaBeta(board, player, constraint, d, -Infinity, Infinity);

        if (abortSearch) break;

        // If we found a forced mate, stop?
        if (result.score > 90000) {
            bestMove = result.move;
            bestScore = result.score;
            break;
        }

        bestMove = result.move;
        bestScore = result.score;

        if (performance.now() - searchStartTime > timeLimit) break;
    }

    return {
        move: bestMove || [],
        score: bestScore,
        depth: config.maxDepth, // or actual reached depth
        nodes: nodesVisited,
        time: performance.now() - searchStartTime
    };
}

function alphaBeta(board: BoardNode, player: Player, constraint: number[], depth: number, alpha: number, beta: number): { score: number, move: number[] | null } {
    nodesVisited++;
    if ((nodesVisited & 4095) === 0) {
        if (performance.now() - searchStartTime > timeLimit) {
            abortSearch = true;
        }
    }
    if (abortSearch) return { score: 0, move: null };

    // TT Lookup (omitted for brevity/complexity in first pass, but good to have)
    // const hash = computeHash(board, player); // Expensive?

    if (depth === 0) {
        return { score: evaluate(board, player), move: null };
    }

    // Move Gen
    const moves = generateMoves(board, constraint);
    if (moves.length === 0) {
        // No moves. Evaluated as loss or draw?
        // If I can't move, is it stalemate or loss?
        // In TTT, if board full, handled by evaluator (recursive win check).
        // If blocked, evaluate state.
        return { score: evaluate(board, player), move: null };
    }

    // Move Ordering?
    // Sort moves... (TODO)

    let bestMove: number[] | null = null;
    let bestScore = -Infinity; // Alpha is lower bound

    for (const move of moves) {
        const undo = applyMove(board, move, player);

        // Calculate next state
        const winLevel = undo.changedNodes.length;
        // Check immediate win
        // If we won the root (winLevel that reaches root, usually 4 for depth4 game?), return WIN
        // undo.changedNodes has path to node. 
        // changedNodes[last] is highest level won.
        // If board.winner is set, we won the game!

        if (board.winner === player) {
            undoMove(board, undo);
            return { score: SCORE_WIN + depth, move };
        }

        let nextConstraint = calculateNextConstraint(move, winLevel);
        while (nextConstraint.length > 0 && !isPlayable(board, nextConstraint)) {
            nextConstraint.pop();
        }

        const opponent = player === 'X' ? 'O' : 'X';
        const result = alphaBeta(board, opponent, nextConstraint, depth - 1, -beta, -alpha);
        const score = -result.score;

        undoMove(board, undo);

        if (abortSearch) return { score: 0, move: null };

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }

        if (score > alpha) {
            alpha = score;
        }

        if (alpha >= beta) {
            // Cutoff
            break;
        }
    }

    return { score: bestScore, move: bestMove };
}
