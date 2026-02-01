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

// Check if board is completely empty (no moves made)
export const isEmpty = (board: BoardNode): boolean => {
    if (board.value !== null) return false;
    if (!board.children) return true;
    return board.children.every(child => isEmpty(child));
};

// Check if a player CAN possibly win this board
export const canWin = (board: BoardNode, player: Player): boolean => {
    // 1. Already won by us -> True
    if (board.winner === player) return true;
    // 2. Won by opponent or Drawn -> False
    if (board.winner && board.winner !== player) return false;

    // 3. Leaf Node
    if (!board.children) {
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

// Check if a path is valid to play (no intermediate node is won/drawn)
export const isValidPath = (board: BoardNode, path: number[]): boolean => {
    let node = board;
    // Check root winner
    if (node.winner) return false;

    for (let i = 0; i < path.length; i++) {
        if (!node.children) {
            // If we expect to go deeper but can't, it's invalid (unless we are at leaf? path should match depth)
            return false;
        }

        node = node.children[path[i]];

        // Cannot play in won/drawn node
        if (node.winner) return false;
    }

    // Check if leaf is empty
    if (node.value !== null) return false;

    return true;
};

// Convert Grid Coordinates (e.g. 26, 19) to Path Indices (e.g. [8, 4, 1])
export const getPathFromCoordinates = (gridX: number, gridY: number, depth: number): number[] => {
    const pathIdxs: number[] = [];
    let remX = gridX;
    let remY = gridY;

    for (let i = 0; i < depth; i++) {
        const scale = Math.pow(3, depth - 1 - i);
        const x = Math.floor(remX / scale);
        const y = Math.floor(remY / scale);
        pathIdxs.push(y * 3 + x);
        remX %= scale;
        remY %= scale;
    }
    return pathIdxs;
};

// Determine the depth at which the move caused a win (Bottom-Up)
// Returns 'depth' if no win caused, or 0-(depth-1) if a higher level won.
export const getWonDepth = (nodes: BoardNode[], depth: number): number => {
    let wonDepth = depth;

    // Check from Leaf Parent (d-1) up to Root (0)
    for (let i = depth - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.winner) {
            // Already won, maybe checking higher?
            // Actually engine logic checks if *this move* caused a win.
            // If node.winner was already set before, we wouldn't be playing here?
            // "nodes" contains the *new* state after modification.
            wonDepth = i;
            continue;
        }

        // Check if now won
        const res = node.children ? checkWin(node.children) : null;
        if (res) {
            node.winner = res.winner;
            node.winPattern = res.pattern;
            wonDepth = i;
        } else {
            // Stop propagation if this level didn't win
            break;
        }
    }
    return wonDepth;
};

// Calculate the Next Constraint based on where the win occurred
export const getNextConstraint = (path: number[], wonDepth: number): number[] => {
    if (wonDepth > 0) {
        // If a board at `wonDepth` was won, player is sent to the relative position in that board.
        const contextDepth = Math.max(0, wonDepth - 2);
        const context = path.slice(0, contextDepth);
        const targetIndex = path[wonDepth - 1];
        return [...context, targetIndex];
    }
    return [];
};
