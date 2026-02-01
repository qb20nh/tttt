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
                // We are at Layer C. Leaves are at Layer D.
                // Scale = 9^(D - 1 - C) ? 
                // Wait. Layer D-1 (Leaf Parents) -> Scale 1 (Size 9).
                // Layer D-2 -> Scale 9 (Size 81).
                // Scale = 9^(D - 1 - constraintLayer).

                // Example: D=4. Leafs.
                // Constraint at Layer 3 (Leaf Parent). D-1=3. Scale=1. Ranges 9 leafs.
                // Constraint at Layer 2. Scale=9. Ranges 81 leafs.

                const power = D - 1 - constraintLayer;
                // Precompute powers? Math.pow(9, p)
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
                if (!validSubboard) {
                    // Check all ancestors from leaf parent up to root
                    let ancestorIdx = i;
                    let skipTo = -1;

                    for (let layer = D - 1; layer >= 0; layer--) {
                        ancestorIdx = (ancestorIdx / 9) >>> 0;
                        if (MoveGen.isNodeFullOrWon(board, layer, ancestorIdx)) {
                            // Skip all leaves under this won/full ancestor
                            const power = D - layer;
                            let skipSize = 1;
                            for (let k = 0; k < power; k++) skipSize *= 9;
                            skipTo = (ancestorIdx + 1) * skipSize - 1;
                            break;
                        }
                    }

                    if (skipTo !== -1) {
                        i = skipTo;
                        continue;
                    }
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
