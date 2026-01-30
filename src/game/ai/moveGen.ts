import type { BoardNode } from '../types';
import { isFull } from '../logic';

export function generateMoves(board: BoardNode, activeConstraint: number[]): number[][] {
    const moves: number[][] = [];

    // 1. Find the target node based on constraint
    let target = board;
    let validPath = true;

    for (const idx of activeConstraint) {
        if (target.children && target.children[idx]) {
            target = target.children[idx];
        } else {
            validPath = false;
            break;
        }
    }

    // If constrained target is full/won, we can play ANYWHERE (global fallback)
    // Or if constraints dictate, we bubble up?
    // In Ultimate TTT, if target is full, you play anywhere.
    // In Fractal TTT engine.ts: 
    // if (nextC.length > 0 && !isPlayable(nextC)) nextC = [];
    // So if constraint leads to unplayable, key is empty (anywhere).

    // So 'activeConstraint' passed here should already be resolved.
    // If it's [], we search whole board.

    if (!validPath || target.winner || isFull(target)) {
        // Search globally (depth 4)
        // This is expensive? 6561 cells.
        // We need to find all valid leaves.
        collectMoves(board, [], moves, 4);
    } else {
        // Search within target
        // We need to complete the path.
        // If constraint is length 2 ([p0, p1]), we need [p2, p3].
        collectMoves(target, activeConstraint, moves, 4 - activeConstraint.length);
    }

    return moves;
}

function collectMoves(node: BoardNode, currentPath: number[], moves: number[][], depthRemaining: number) {
    if (node.winner || (node.value !== null)) return; // Can't play here

    if (depthRemaining === 0) {
        // We are at leaf (or past it?)
        // Actually for depth 4:
        // Root (depth 4) -> L1 (d3) -> L2 (d2) -> L3 (d1) -> Leaf
        // Wait, 'generateBoard(4)' means 4 levels of recursion.
        // Leaf has no children.

        // If node has value, we can't play.
        // If node is empty (value===null) and no children, it's a valid move.
        moves.push([...currentPath]);
        return;
    }

    if (!node.children) {
        // Should not happen if depthRemaining > 0 unless board structure is non-uniform
        return;
    }

    // Move Ordering: Center -> Corners -> Edges
    const order = [4, 0, 2, 6, 8, 1, 3, 5, 7]; // 4 is center

    for (const i of order) {
        collectMoves(node.children[i], [...currentPath, i], moves, depthRemaining - 1);
    }
}
