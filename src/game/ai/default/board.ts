import { CELL_O, CELL_X } from './constants'
import { LUT_WIN_STATUS_BASE4, LUT_SCORE_BASE4, initTables } from './lookup'
import { ZOBRIST_TABLE } from './zobrist'

// Ensure tables are init
initTables()

export class Board {
  public depth: number
  public hash: bigint = 0n

  // leaf cells: simple array of 0,1,2
  // size = 9^depth
  public leaves: Int8Array

  // Keys for each hierarchy level (Leaf Parents to Root)
  public keys: Int32Array[]

  // Constraint: Index of the board we are constrained to
  // Range: 0 to 9^(constraintLayer) - 1.
  // -1 means Free Play (anywhere).
  public constraint: number = -1
  public constraintLayer: number = -1

  constructor (depth: number) {
    this.depth = depth
    this.constraintLayer = depth - 1

    // Init Leaves
    const leafCount = Math.pow(9, depth)
    this.leaves = new Int8Array(leafCount)

    // Init Hierarchy Keys
    this.keys = []
    for (let d = 0; d < depth; d++) {
      const size = Math.pow(9, d)
      this.keys.push(new Int32Array(size))
    }
  }

  public getCell (idx: number): number {
    return this.leaves[idx]
  }

  // Set Cell Value and propagate changes up
  // Returns the layer index (0..depth-1) of the highest node that changed STATUS.
  // Returns -1 if no status change occurred (only leaf value changed).
  public setCell (idx: number, val: number): number {
    // 1. Update Leaf
    const oldLeafVal = this.leaves[idx]
    if (oldLeafVal === val) return -1 // No change

    // Update components for Zobrist
    // Out: oldVal
    // In: val
    if (oldLeafVal !== 0) {
      this.hash ^= ZOBRIST_TABLE[idx * 4 + oldLeafVal]
    }
    if (val !== 0) {
      this.hash ^= ZOBRIST_TABLE[idx * 4 + val]
    }

    this.leaves[idx] = val

    // 2. Propagate Up
    let currentIdx = idx
    let diffVal = val

    let highestChangedLayer = -1

    for (let d = this.depth - 1; d >= 0; d--) {
      const pIdx = (currentIdx / 9) >>> 0 // floor
      const childOffset = currentIdx % 9

      // Get current key
      const oldKey = this.keys[d][pIdx]
      const shift = childOffset * 2
      const oldChildStatus = (oldKey >>> shift) & 3

      if (diffVal === oldChildStatus) {
        return highestChangedLayer
      }

      // Update Key
      const newKey = oldKey ^ ((oldChildStatus ^ diffVal) << shift)
      this.keys[d][pIdx] = newKey

      // Check if THIS node's status changed
      const oldNodeStatus = LUT_WIN_STATUS_BASE4[oldKey]
      const newNodeStatus = LUT_WIN_STATUS_BASE4[newKey]

      if (oldNodeStatus === newNodeStatus) {
        return highestChangedLayer
      }

      // Status changed! Track this layer.
      highestChangedLayer = d

      // Prepare for next loop
      diffVal = newNodeStatus
      currentIdx = pIdx
    }

    return highestChangedLayer
  }

  public getWinner (): number {
    return LUT_WIN_STATUS_BASE4[this.keys[0][0]]
  }

  public evaluate (player: number): number {
    let score = 0

    // Evaluate layers with diminishing weights (1000 -> 100 -> 10 -> 1)

    let weight = 1000
    for (let d = 0; d < this.depth; d++) {
      const layer = this.keys[d]
      for (let i = 0; i < layer.length; i++) {
        score += LUT_SCORE_BASE4[layer[i]] * weight
      }
      weight = Math.floor(weight / 10)
      if (weight < 1) weight = 1
    }

    // Cap heuristic to ensure it never exceeds terminal win detection threshold
    const MAX_HEURISTIC = 50000
    score = Math.max(-MAX_HEURISTIC, Math.min(MAX_HEURISTIC, score))

    // Free Move Advantage: Bonus for being unconstrained
    if (this.constraint === -1) {
      if (player === CELL_X) score += 20
      else if (player === CELL_O) score -= 20
    }

    if (player === CELL_O) return -score
    return score
  }

  public clone (): Board {
    const copy = new Board(this.depth)
    copy.leaves.set(this.leaves)
    for (let i = 0; i < this.depth; i++) {
      copy.keys[i].set(this.keys[i])
    }
    copy.constraint = this.constraint
    copy.constraintLayer = this.constraintLayer
    copy.hash = this.hash
    return copy
  }
}
