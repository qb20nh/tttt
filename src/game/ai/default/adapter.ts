import type { BoardNode } from '../../types';
import { Board } from './board';
import { CELL_EMPTY, CELL_X, CELL_O } from './constants';

export class BoardAdapter {
    static toBoard(root: BoardNode, depth: number, activeConstraint: number[]): Board {
        const board = new Board(depth);

        // 1. Fill Leaves
        const traverse = (node: BoardNode, currentDepth: number, globalIdx: number) => {
            if (currentDepth === depth) {
                // Leaf
                let val = CELL_EMPTY;
                if (node.value === 'X') val = CELL_X;
                else if (node.value === 'O') val = CELL_O;

                if (val !== CELL_EMPTY) {
                    board.setCell(globalIdx, val);
                }
                return;
            }

            if (node.children) {
                const scale = Math.pow(9, depth - 1 - currentDepth);
                for (let i = 0; i < 9; i++) {
                    traverse(node.children[i], currentDepth + 1, globalIdx + i * scale);
                }
            }
        };

        traverse(root, 0, 0);

        // 2. Set Constraint
        if (activeConstraint.length === 0) {
            board.constraint = -1;
            board.constraintLayer = -1;
        } else {
            let constraintIdx = 0;
            for (let i = 0; i < activeConstraint.length; i++) {
                constraintIdx = constraintIdx * 9 + activeConstraint[i];
            }

            board.constraint = constraintIdx;
            board.constraintLayer = activeConstraint.length;
        }

        return board;
    }
}
