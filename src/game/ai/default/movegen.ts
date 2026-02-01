import { Board } from './board';
import { CELL_EMPTY } from './constants';
import { LUT_WIN_STATUS_BASE4 } from './lookup';

export class MoveGen {

    static generate(board: Board, outArray: Int32Array, offset: number): number {
        let count = 0;
        const D = board.depth;

        // 1. Determine Search Range
        let rangeStart = 0;
        let rangeEnd = board.leaves.length; // Exclusive

        const constraint = board.constraint;
        const constraintLayer = board.constraintLayer;

        let validSubboard = false;

        if (constraint !== -1) {
            // Check if constrained target is playable
            // The constraint is at 'constraintLayer'.
            // The constraint index is into keys[constraintLayer].
            if (!MoveGen.isNodeFullOrWon(board, constraintLayer, constraint)) {
                validSubboard = true;

                // Calculate Leaf Range covered by this constraint
                const power = D - 1 - constraintLayer;
                // Scale = 9^(D - 1 - constraintLayer)
                let scale = 1;
                for (let k = 0; k < power; k++) scale *= 9;

                // Start Index of Leaf Parent
                const leafParentStart = constraint * scale;
                // End Index
                const leafParentEnd = leafParentStart + scale;

                // Leaf Indices range:
                rangeStart = leafParentStart * 9;
                rangeEnd = leafParentEnd * 9;
            }
        }

        // 2. Iterate and Collect
        for (let i = rangeStart; i < rangeEnd; i++) {
            // Check if leaf is empty
            if (board.leaves[i] === CELL_EMPTY) {
                // If Global Search (or Constraint Invalidated), we must check ancestry playability.
                // Validate ancestry from Leaf Parent up to Constraint Layer (exclusive).
                const checkLimit = validSubboard ? (constraintLayer + 1) : 0;

                let ancestorIdx = i;
                let skipTo = -1;

                for (let layer = D - 1; layer >= checkLimit; layer--) {
                    ancestorIdx = (ancestorIdx / 9) >>> 0;
                    if (MoveGen.isNodeFullOrWon(board, layer, ancestorIdx)) {
                        // Skip all leaves under this won/full ancestor
                        const power = D - layer;
                        let skipSize = 1;
                        for (let k = 0; k < power; k++) skipSize *= 9;

                        // Calculate last leaf index to skip to
                        // skipTo = (ancestorIdx + 1) * 9^(power) - 1

                        skipTo = (ancestorIdx + 1) * skipSize - 1;
                        break;
                    }
                }

                if (skipTo !== -1) {
                    i = skipTo;
                    continue;
                }

                outArray[offset + count] = i;
                count++;
            }
        }

        return count;
    }

    // Check if node at specific layer/index is won/full
    static isNodeFullOrWon(board: Board, layer: number, nodeIdx: number): boolean {
        const key = board.keys[layer][nodeIdx];
        const status = LUT_WIN_STATUS_BASE4[key];
        return status !== 0; // 0=Playing
    }
}
