import type { BoardNode, Player } from './types';
import { WIN_PATTERNS } from './constants';

export const generateBoard = (currentDepth: number): BoardNode => {
    if (currentDepth === 0) return { winner: null, winPattern: -1, value: null, children: null };
    return {
        winner: null,
        winPattern: -1,
        value: null,
        children: Array(9).fill(null).map(() => generateBoard(currentDepth - 1)),
    };
};

export const checkWin = (cells: BoardNode[]) => {
    for (let i = 0; i < WIN_PATTERNS.length; i++) {
        const [a, b, c] = WIN_PATTERNS[i];
        const valA = cells[a].winner || cells[a].value;
        const valB = cells[b].winner || cells[b].value;
        const valC = cells[c].winner || cells[c].value;
        if (valA && valA === valB && valA === valC) {
            return { winner: valA as Player, pattern: i };
        }
    }
    return null;
};

export const isFull = (board: BoardNode): boolean => {
    if (board.winner) return true;
    if (!board.children) return board.value !== null;
    return board.children.every(child =>
        (child.winner !== null) || (child.value !== null) || isFull(child)
    );
};
