import type { BoardNode } from '../../types';
import { Board } from './board';
import { CELL_EMPTY, CELL_X, CELL_O, CELL_DRAW } from './constants';

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

        // 1.5 Sync Node States (Winner/Draw)
        // BoardAdapter normally reconstructs state from leaves.
        // HOWEVER, Engine has "Early Stalemate" logic (canWin) which might mark a node as 'Draw'
        // even if it's not full. The AI needs to respect this.

        const syncWinners = (node: BoardNode, currentDepth: number, globalIdx: number) => {
            // We only care about non-leaf nodes here, as leaves are set via setCell.
            // But if a leaf is 'Draw', setCell might not handle it if logic differs.
            // Actually, for consistency, let's enforce all known winners.

            if (node.winner) {
                // Convert winner to int
                let winVal = CELL_EMPTY; // Should not be empty if winner is set
                if (node.winner === 'X') winVal = CELL_X;
                else if (node.winner === 'O') winVal = CELL_O;
                else if (node.winner === 'Draw') winVal = CELL_DRAW;

                if (winVal !== CELL_EMPTY) {
                    // We need to Find the index in the hierarchy.
                    // The 'keys' array stores state for each layer.
                    // Layer 0 = Root.
                    // Layer D-1 = Leaf Parents.

                    // currentDepth 0 -> Root -> keys[0][0]
                    // currentDepth 1 -> Level 1 -> keys[1][idx]

                    // Calculate index at this depth
                    const layerIdx = Math.floor(globalIdx / Math.pow(9, depth - currentDepth));

                    // Verify if board.keys[currentDepth] exists
                    if (currentDepth < depth && board.keys[currentDepth]) {
                        // We enforce the state.
                        // WARNING: This overwrites whatever setCell calculated.
                        // This is desired because Engine is authority.

                        // BUT: The key also contains 8 other siblings... No.
                        // keys[d] is an array of Int32. Each Int32 represents ONE node (packed with its 9 children statuses).
                        // Wait.
                        // Let's re-read board.ts structure.
                        // keys[d][i] is a KEY (Int32) representing the configuration of children of node i at layer d.
                        // The STATUS of node i is derived from keys[d][i].

                        // So if node i has winner 'W', then the PARENT of node i (at layer d-1) needs to know that node i is W.
                        // keys[d-1][parentOfI] contains the status of node i encoded in 2 bits.

                        // So to set node i status:
                        // We must update keys[d-1][parentOfI].

                        if (currentDepth > 0) {
                            const pLayer = currentDepth - 1;
                            const pIdx = Math.floor(layerIdx / 9);
                            const childOffset = layerIdx % 9;

                            const oldKey = board.keys[pLayer][pIdx];
                            const shift = childOffset * 2;

                            // Clear old 2 bits
                            const mask = ~(3 << shift);
                            const cleanKey = oldKey & mask;

                            // Set new 2 bits
                            const newKey = cleanKey | (winVal << shift);

                            board.keys[pLayer][pIdx] = newKey;
                        } else {
                            // Root status? 
                            // Root doesn't have a parent key.
                            // But board.evaluate uses keys[0][0] to see root config.
                            // Wait. keys[0][0] represents the Root Node. Its value is the composition of its 9 children (L1 nodes).
                            // The STATUS of the Root is derived from keys[0][0] via LUT.

                            // If the Root itself is forced won (e.g. Draw), but the children don't imply it?
                            // Then LUT won't return Draw.
                            // This is a problem. The LUT rules are fixed.

                            // If Engine says "Draw", it means either:
                            // A) 3-in-row -> LUT handles it.
                            // B) Full -> LUT handles it.
                            // C) Stalemate (Unwinnable) -> LUT DOES NOT handle it.

                            // If C, and we want AI to know it's a Draw...
                            // We must fake the children to looks like a Draw? No.
                            // We might need to override 'getWinner()'? 
                            // But AI Search uses 'getWinner()' (which uses LUT on keys[0]).

                            // If the root is forcefully drawn, we can't easily express that content-wise if it's sparse.
                            // BUT, if a SUB-BOARD is drawn, we update the Parent Key (keys[layer-1]).
                            // Does the Parent Key simply store the child statuses?
                            // Yes. Child status is 2 bits.
                            // 0=Playing, 1=X, 2=O, 3=Draw.

                            // So yes! We just need to update the PARENT key to say "This child is 3 (Draw)".
                            // Then the LUT lookup for the parent will see a '3' in that slot and process it accordingly.

                            // Exception: Checks against Root Node status.
                            // If Root is drawn, there is no parent key.
                            // But 'search.ts' checks 'board.getWinner()'. 
                            // We can't update a parent key for root.
                            // However, if Root is drawn, the game is over. Search shouldn't happen or should return immediately.
                            // If Engine asks for search on a Finished board, that's an error in caller or handling.
                            // We assume we are searching a live board.
                        }
                    }
                }
            } else {
                // Determine scale for recursion
                if (node.children) {
                    const scale = Math.pow(9, depth - 1 - currentDepth);
                    for (let i = 0; i < 9; i++) {
                        syncWinners(node.children[i], currentDepth + 1, globalIdx + i * scale);
                    }
                }
            }
        };

        syncWinners(root, 0, 0);

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
