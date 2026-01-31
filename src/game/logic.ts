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

// Check if a player CAN possibly win this board
export const canWin = (board: BoardNode, player: Player): boolean => {
    // 1. Already won by us -> True
    if (board.winner === player) return true;
    // 2. Won by opponent or Drawn -> False
    if (board.winner && board.winner !== player) return false;

    // 3. Leaf Node
    if (!board.children) {
        // If empty (value=null), we CAN win it.
        // If taken by us, we CAN use it (already done).
        // If taken by opponent, we CAN'T.
        return board.value === null || board.value === player;
    }

    // 4. Recursive Check
    // We need AT LEAST ONE strictly valid winning pattern.
    // A pattern is valid if ALL 3 cells in it are 'winnable'.
    for (const pattern of WIN_PATTERNS) {
        const [a, b, c] = pattern;
        if (canWin(board.children[a], player) &&
            canWin(board.children[b], player) &&
            canWin(board.children[c], player)) {
            return true;
        }
    }

    return false;
};
