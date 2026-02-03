import type { BoardNode } from '../../types'
import { Board } from './board'
import { CELL_EMPTY, CELL_X, CELL_O, CELL_DRAW } from './constants'

export class BoardAdapter {
  static toBoard (
    root: BoardNode,
    depth: number,
    activeConstraint: number[]
  ): Board {
    const board = new Board(depth)

    // 1. Fill Leaves
    const traverse = (
      node: BoardNode,
      currentDepth: number,
      globalIdx: number
    ) => {
      if (currentDepth === depth) {
        // Leaf
        let val = CELL_EMPTY
        if (node.value === 'X') val = CELL_X
        else if (node.value === 'O') val = CELL_O

        if (val !== CELL_EMPTY) {
          board.setCell(globalIdx, val)
        }
        return
      }

      if (node.children) {
        const scale = Math.pow(9, depth - 1 - currentDepth)
        for (let i = 0; i < 9; i++) {
          traverse(node.children[i], currentDepth + 1, globalIdx + i * scale)
        }
      }
    }

    traverse(root, 0, 0)

    // 1.5 Sync Node States (Winner/Draw)
    // Engine might flag nodes as 'Draw' (Early Stalemate) even if not full.
    // We must sync these states to the Board instance so AI respects them.

    const syncWinners = (
      node: BoardNode,
      currentDepth: number,
      globalIdx: number
    ) => {
      // We only care about non-leaf nodes here, as leaves are set via setCell.
      // But if a leaf is 'Draw', setCell might not handle it if logic differs.
      // Actually, for consistency, let's enforce all known winners.

      if (node.winner) {
        // Convert winner to int
        let winVal = CELL_EMPTY // Should not be empty if winner is set
        if (node.winner === 'X') winVal = CELL_X
        else if (node.winner === 'O') winVal = CELL_O
        else if (node.winner === 'Draw') winVal = CELL_DRAW

        if (winVal !== CELL_EMPTY) {
          // We need to Find the index in the hierarchy.
          // The 'keys' array stores state for each layer.
          // Layer 0 = Root.
          // Layer D-1 = Leaf Parents.

          // Calculate index at this depth
          const layerIdx = Math.floor(
            globalIdx / Math.pow(9, depth - currentDepth)
          )

          // We enforce the state by updating the parent's key for this node.
          // board.keys[currentDepth] stores the key representing children of nodes at this depth.
          // But to set the status of a node at `currentDepth`, we must update the key at `currentDepth-1` (Parent Layer).

          if (currentDepth > 0) {
            const pLayer = currentDepth - 1
            const pIdx = Math.floor(layerIdx / 9)
            const childOffset = layerIdx % 9

            const oldKey = board.keys[pLayer][pIdx]
            const shift = childOffset * 2

            // Clear old 2 bits and set new status
            const mask = ~(3 << shift)
            const cleanKey = oldKey & mask
            const newKey = cleanKey | (winVal << shift)

            board.keys[pLayer][pIdx] = newKey
          }
          // Note: If currentDepth is 0 (Root), we cannot update a parent key.
          // However, if Root is drawn/won, the game is effectively over for search purposes.
        }
      } else {
        // Determine scale for recursion
        if (node.children) {
          const scale = Math.pow(9, depth - 1 - currentDepth)
          for (let i = 0; i < 9; i++) {
            syncWinners(
              node.children[i],
              currentDepth + 1,
              globalIdx + i * scale
            )
          }
        }
      }
    }

    syncWinners(root, 0, 0)

    // 2. Set Constraint
    if (activeConstraint.length === 0) {
      board.constraint = -1
      board.constraintLayer = -1
    } else {
      let constraintIdx = 0
      for (let i = 0; i < activeConstraint.length; i++) {
        constraintIdx = constraintIdx * 9 + activeConstraint[i]
      }

      board.constraint = constraintIdx
      board.constraintLayer = activeConstraint.length
    }

    return board
  }
}
