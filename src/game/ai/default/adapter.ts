import type { BoardNode, Winner } from '../../types'
import { Board } from './board'
import { CELL_EMPTY, CELL_X, CELL_O, CELL_DRAW } from './constants'
import { LUT_WIN_STATUS_BASE4 } from './lookup'
import { ZOBRIST_TABLE_LOW, ZOBRIST_TABLE_HIGH } from './zobrist'

const cellValue = (value: Winner): number => {
  if (value === 'X') return CELL_X
  if (value === 'O') return CELL_O
  if (value === 'Draw') return CELL_DRAW
  return CELL_EMPTY
}

// Explicit closures can contain empty descendants (for example an early draw).
// Give those statuses their own hash component; leaf hashes alone lose them.
const closureHash = (layer: number, index: number, status: number): bigint => {
  let hash = (BigInt(layer + 1) << 32n) | (BigInt(index) << 2n) | BigInt(status)
  hash = BigInt.asUintN(64, hash + 0x9e3779b97f4a7c15n)
  hash = BigInt.asUintN(64, (hash ^ (hash >> 30n)) * 0xbf58476d1ce4e5b9n)
  hash = BigInt.asUintN(64, (hash ^ (hash >> 27n)) * 0x94d049bb133111ebn)
  return hash ^ (hash >> 31n)
}

export class BoardAdapter {
  static toBoard (
    root: BoardNode,
    depth: number,
    activeConstraint: number[]
  ): Board {
    const board = new Board(depth)

    // Build each hierarchy key once, after its descendants. Replaying occupied
    // leaves via setCell repeatedly updates the same ancestors and cannot carry
    // authoritative closures into their grandparents.
    const traverse = (node: BoardNode, layer: number, index: number): number => {
      if (layer === depth) {
        const value = cellValue(node.winner || node.value)
        board.leaves[index] = value
        if (value !== CELL_EMPTY) {
          board.hashLow ^= ZOBRIST_TABLE_LOW[index * 4 + value]
          board.hashHigh ^= ZOBRIST_TABLE_HIGH[index * 4 + value]
        }
        return value
      }

      let key = 0
      if (node.children) {
        for (let i = 0; i < 9; i++) {
          key |= traverse(node.children[i], layer + 1, index * 9 + i) << (i * 2)
        }
      }
      board.keys[layer][index] = key

      const derivedStatus = LUT_WIN_STATUS_BASE4[key]
      const explicitStatus = cellValue(node.winner)
      if (explicitStatus !== CELL_EMPTY && explicitStatus !== derivedStatus) {
        board.hash ^= closureHash(layer, index, explicitStatus)
      }
      return explicitStatus || derivedStatus
    }

    traverse(root, 0, 0)
    board.rootWinner = cellValue(root.winner)
    board.rebuildEvaluation()

    if (activeConstraint.length > 0) {
      let constraint = 0
      for (const index of activeConstraint) constraint = constraint * 9 + index
      board.constraint = constraint
      board.constraintLayer = activeConstraint.length
    } else {
      board.constraint = -1
      board.constraintLayer = -1
    }
    board.normalizeConstraint()

    return board
  }
}
