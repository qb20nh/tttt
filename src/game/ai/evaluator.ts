import type { BoardNode, Player } from '../types';
import { WIN_PATTERNS } from '../constants';

const SCORES = {
    WIN: 100000,
    LOSS: -100000,
    NEAR_WIN: 1000,     // 2 in a row
    NEAR_LOSS: -1000,
    ADVANTAGE: 10,
    DISADVANTAGE: -10
};

// Evaluate board from perspective of 'player'
export function evaluate(board: BoardNode, player: Player, boardDepth: number): number {
    return evaluateNode(board, player, 0, boardDepth);
}

function evaluateNode(node: BoardNode, player: Player, level: number, boardDepth: number): number {
    // If this node is won by someone
    if (node.winner) {
        if (node.winner === player) return SCORES.WIN * (boardDepth - level);
        return SCORES.LOSS * (boardDepth - level);
    }

    // If it's a leaf and has a value
    if (node.value) {
        if (node.value === player) return SCORES.ADVANTAGE;
        return SCORES.DISADVANTAGE;
    }

    if (!node.children) return 0;

    let score = 0;

    // 1. Evaluate children recursively
    // Optimization: Don't go too deep if not needed.
    // But for depth 4, we might need to.

    // Actually, full recursion is too slow for heuristic eval.
    // We should only recurse if the node is "active" or interesting.
    // But for a static evaluator locally, we usually assume we are at leaf of search.

    // Let's do a shallow eval based on the state of this node's grid (3x3).
    // The "state" of this node is determined by the winners/values of its children.

    // Check for 2-in-a-rows of children
    const patternScore = evaluatePatterns(node.children, player);

    score += patternScore * (boardDepth - level) * 10;

    // Add up scores from children (weighted lower)
    // We only recurse if we are NOT at the drawing limit of the canvas... wait this is AI.
    // We recurse 1 level deeper?
    // If we are at the search horizon, we need a value.
    // If we just sum children, it validates material.

    for (const child of node.children) {
        // If child is won/value, it was handled by evaluatePatterns?
        // No, evaluatePatterns handles geometric arrangement (lines).
        // We also want material count.

        if (child.winner || child.value) {
            // Already counted as "mark" in evaluatePatterns?
            // Let's explicitly count material.
            if ((child.winner || child.value) === player) score += SCORES.ADVANTAGE;
            else if ((child.winner || child.value) !== null) score += SCORES.DISADVANTAGE;
        } else {
            // Recurse to capture nested advantages
            score += evaluateNode(child, player, level + 1, boardDepth) * 0.2;
        }
    }

    // Positional Bonus (Center control)
    // Center (4) > Corners (0,2,6,8) > Edges (1,3,5,7)
    if (node.children) {
        const center = node.children[4];
        if ((center.winner || center.value) === player) score += SCORES.ADVANTAGE * 0.5;
    }

    return score;
}

function evaluatePatterns(cells: BoardNode[], player: Player): number {
    let score = 0;
    const opponent = player === 'X' ? 'O' : 'X';

    for (const pattern of WIN_PATTERNS) {
        let pCount = 0;
        let oCount = 0;

        for (const idx of pattern) {
            const cellOwner = cells[idx].winner || cells[idx].value;
            if (cellOwner === player) pCount++;
            else if (cellOwner === opponent) oCount++;
        }

        if (pCount === 3) score += SCORES.WIN; // Should be handled by node.winner check usually
        else if (oCount === 3) score += SCORES.LOSS;
        else if (pCount === 2 && oCount === 0) score += SCORES.NEAR_WIN;
        else if (oCount === 2 && pCount === 0) score += SCORES.NEAR_LOSS;
        else if (pCount === 1 && oCount === 0) score += 10;
        else if (oCount === 1 && pCount === 0) score -= 10;
    }
    return score;
}
