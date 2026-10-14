import { Board } from './board'
import { LUT_EMPTY_MASK_BASE4 } from './lookup'

const POPCOUNT = new Uint8Array(512)
for (let mask = 1; mask < POPCOUNT.length; mask++) POPCOUNT[mask] = POPCOUNT[mask >>> 1] + (mask & 1)

export class MoveGen {
  // A search horizon needs only this capped global count, irrespective of the
  // current target. Avoid materializing thousands of moves to compute a bound.
  static countGlobal (board: Board, limit: number): number {
    if (limit <= 0 || board.getWinner() !== 0) return 0
    return MoveGen.countNode(board, 0, 0, limit)
  }

  private static countNode (board: Board, layer: number, nodeIdx: number, limit: number): number {
    if (board.getNodeStatus(layer, nodeIdx) !== 0) return 0
    let mask = LUT_EMPTY_MASK_BASE4[board.keys[layer][nodeIdx]]
    if (layer === board.depth - 1) return Math.min(limit, POPCOUNT[mask])
    let count = 0
    while (mask !== 0 && count < limit) {
      const bit = mask & -mask
      count += MoveGen.countNode(board, layer + 1, nodeIdx * 9 + 31 - Math.clz32(bit), limit - count)
      mask ^= bit
    }
    return count
  }

  static generate (board: Board, outArray: Int32Array, offset: number): number {
    if (board.getWinner() !== 0) return 0

    let layer = board.constraintLayer
    let nodeIdx = board.constraint
    if (nodeIdx >= 0) {
      // Widen one ancestor at a time, as the game engine does. A won
      // ancestor can invalidate a target whose own cells are still open.
      while (layer >= 0 && !board.isPlayableNode(layer, nodeIdx)) {
        nodeIdx = (nodeIdx / 9) >>> 0
        layer--
      }
    } else layer = -1

    return MoveGen.generateNode(board, layer < 0 ? 0 : layer, layer < 0 ? 0 : nodeIdx, outArray, offset)
  }

  private static generateNode (
    board: Board,
    layer: number,
    nodeIdx: number,
    outArray: Int32Array,
    offset: number
  ): number {
    const key = board.keys[layer][nodeIdx]
    if (board.getNodeStatus(layer, nodeIdx) !== 0) return 0
    let mask = LUT_EMPTY_MASK_BASE4[key]
    const firstChild = nodeIdx * 9
    let count = 0
    if (layer === board.depth - 1) {
      while (mask !== 0) {
        const bit = mask & -mask
        outArray[offset + count++] = firstChild + 31 - Math.clz32(bit)
        mask ^= bit
      }
    } else {
      while (mask !== 0) {
        const bit = mask & -mask
        count += MoveGen.generateNode(board, layer + 1, firstChild + 31 - Math.clz32(bit), outArray, offset + count)
        mask ^= bit
      }
    }
    return count
  }

  static isNodeFullOrWon (board: Board, layer: number, nodeIdx: number): boolean {
    if (layer < 0 || layer >= board.depth || nodeIdx < 0 || nodeIdx >= board.keys[layer].length) return true
    return board.getNodeStatus(layer, nodeIdx) !== 0
  }
}
