import type { BoardNode, Player, Winner } from '../types';
import { checkWin, isFull } from '../logic';

export interface MoveUndo {
    path: number[];
    previousValue: Winner;
    previousWinner: Winner;
    previousWinPattern: number;
    changedNodes: {
        path: number[];
        winner: Winner;
        winPattern: number;
    }[];
}

export function applyMove(board: BoardNode, path: number[], player: Player): MoveUndo {
    const undo: MoveUndo = {
        path,
        previousValue: null,
        previousWinner: null,
        previousWinPattern: -1,
        changedNodes: []
    };

    const nodes: BoardNode[] = [board];
    let current = board;
    for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i];
        if (!current.children) throw new Error("Invalid path");
        current = current.children[idx];
        nodes.push(current);
    }
    const leafIdx = path[path.length - 1];

    if (!current.children) throw new Error("Leaf parent has no children");
    const leaf = current.children[leafIdx];

    undo.previousValue = leaf.value;
    undo.previousWinner = leaf.winner;

    leaf.value = player;

    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.winner) break;

        if (!node.children) continue;

        const winResult = checkWin(node.children);
        if (winResult) {
            undo.changedNodes.push({
                path: path.slice(0, i),
                winner: node.winner,
                winPattern: node.winPattern
            });
            node.winner = winResult.winner;
            node.winPattern = winResult.pattern;
        } else {
            break;
        }
    }

    return undo;
}

export function undoMove(board: BoardNode, undo: MoveUndo): void {
    for (const change of undo.changedNodes) {
        let node = board;
        for (const idx of change.path) {
            if (node.children) node = node.children[idx];
        }
        node.winner = change.winner;
        node.winPattern = change.winPattern;
    }

    let current = board;
    for (let i = 0; i < undo.path.length - 1; i++) {
        if (current.children) current = current.children[undo.path[i]];
    }
    if (current.children) {
        const leaf = current.children[undo.path[undo.path.length - 1]];
        leaf.value = undo.previousValue;
        leaf.winner = undo.previousWinner;
    }
}

export function calculateNextConstraint(movePath: number[], winLevel: number): number[] {
    // movePath is [p0, p1, p2, p3] (length 4)
    // winLevel = 0 (no win), 1 (local), 2 (mid), 3 (macro), 4 (root)

    // Logic:
    // keepDepth = 2 - winLevel;
    // nextC = fullMove.slice(0, keepDepth) + fullMove[3 - winLevel]

    const keepDepth = 2 - winLevel;
    if (keepDepth >= 0) {
        const nextC = movePath.slice(0, keepDepth);
        nextC.push(movePath[3 - winLevel]);
        return nextC;
    }
    return []; // If winLevel is 3 or 4, keepDepth is negative, so []?
    // If we win a major board, we probably send player to a larger scope or anywhere?
    // In engine.ts, if keepDepth < 0, nextC is empty.
}

export function isPlayable(board: BoardNode, constraint: number[]): boolean {
    if (constraint.length === 0) return true;

    let node = board;
    for (const idx of constraint) {
        if (!node.children) return false;
        node = node.children[idx];
    }
    return !node.winner && !isFull(node);
}
