import { CELL_DRAW, CELL_O, CELL_X } from './constants'
import { LUT_WIN_STATUS_BASE4, LUT_SCORE_BASE4, LUT_POSSIBLE_WIN_BASE4, initTables } from './lookup'
import { ZOBRIST_TABLE_LOW, ZOBRIST_TABLE_HIGH } from './zobrist'

initTables()

export class Board {
  public depth: number
  public hashLow = 0
  public hashHigh = 0
  public rootWinner = 0
  public leaves: Int8Array
  public keys: Int32Array[]
  public powers: Int32Array
  public layerWeights: Float64Array
  public constraint = -1
  public constraintLayer = -1

  private subtreeScores: Float64Array[]
  private childScores: Float64Array[]
  private possibleKeys: Int32Array[]
  private possibleWins: Uint8Array[]

  constructor (depth: number) {
    this.depth = depth
    this.powers = new Int32Array(depth + 1)
    this.powers[0] = 1
    for (let d = 1; d <= depth; d++) this.powers[d] = this.powers[d - 1] * 9
    this.leaves = new Int8Array(this.powers[depth])
    this.keys = []
    this.subtreeScores = []
    this.childScores = []
    this.possibleKeys = []
    this.possibleWins = []
    this.layerWeights = new Float64Array(depth)
    // Give D2 sector ownership more weight while retaining deeper leaf gradients.
    const decay = depth >= 2 ? 16 : 8
    let weight = depth === 4 ? 256 : 64
    for (let d = 0; d < depth; d++) {
      const size = this.powers[d]
      this.keys.push(new Int32Array(size))
      this.subtreeScores.push(new Float64Array(size))
      this.childScores.push(new Float64Array(size))
      this.possibleKeys.push(new Int32Array(size).fill(0x3ffff))
      this.possibleWins.push(new Uint8Array(size).fill(3))
      this.layerWeights[d] = weight
      weight /= decay
    }
  }

  public getCell (idx: number): number {
    return this.leaves[idx]
  }

  public get hash (): bigint {
    return (BigInt(this.hashHigh >>> 0) << 32n) | BigInt(this.hashLow >>> 0)
  }

  public set hash (value: bigint) {
    this.hashLow = Number(value & 0xffffffffn) | 0
    this.hashHigh = Number((value >> 32n) & 0xffffffffn) | 0
  }

  // Return the highest newly won X/O layer. Full drawn boards affect
  // playability, but do not trigger the engine's win-dependent routing.
  public setCell (idx: number, val: number): number {
    const oldLeafVal = this.leaves[idx]
    if (oldLeafVal === val) return -1
    if (oldLeafVal !== 0) {
      this.hashLow ^= ZOBRIST_TABLE_LOW[idx * 4 + oldLeafVal]
      this.hashHigh ^= ZOBRIST_TABLE_HIGH[idx * 4 + oldLeafVal]
    }
    if (val !== 0) {
      this.hashLow ^= ZOBRIST_TABLE_LOW[idx * 4 + val]
      this.hashHigh ^= ZOBRIST_TABLE_HIGH[idx * 4 + val]
    }
    this.leaves[idx] = val

    let currentIdx = idx
    let childStatus = val
    let childPossible = val === 0 ? 3 : val === CELL_DRAW ? 0 : val
    let scoreDelta = 0
    let highestWonLayer = -1
    let statusChanged = true

    for (let d = this.depth - 1; d >= 0; d--) {
      const pIdx = (currentIdx / 9) >>> 0
      const shift = (currentIdx % 9) * 2
      const oldKey = this.keys[d][pIdx]
      const oldStatus = LUT_WIN_STATUS_BASE4[oldKey]
      let newKey = oldKey
      let newStatus = oldStatus
      if (statusChanged) {
        const oldChildStatus = (oldKey >>> shift) & 3
        newKey ^= (oldChildStatus ^ childStatus) << shift
        this.keys[d][pIdx] = newKey
        newStatus = LUT_WIN_STATUS_BASE4[newKey]
      }
      statusChanged = oldStatus !== newStatus
      if (statusChanged && (newStatus === CELL_X || newStatus === CELL_O)) highestWonLayer = d
      childStatus = newStatus

      const oldPossibleKey = this.possibleKeys[d][pIdx]
      const oldChildPossible = (oldPossibleKey >>> shift) & 3
      const newPossibleKey = oldPossibleKey ^ ((oldChildPossible ^ childPossible) << shift)
      // A capture can change this node's status even when its children already
      // had the same possible winners, so status changes still recompute it.
      if (newPossibleKey !== oldPossibleKey || statusChanged) {
        this.possibleKeys[d][pIdx] = newPossibleKey
        childPossible = newStatus === 0
          ? LUT_POSSIBLE_WIN_BASE4[newPossibleKey]
          : newStatus === CELL_DRAW ? 0 : newStatus
        this.possibleWins[d][pIdx] = childPossible
      } else childPossible = this.possibleWins[d][pIdx]

      const oldScore = this.subtreeScores[d][pIdx]
      if (d < this.depth - 1) this.childScores[d][pIdx] += scoreDelta
      // Closed descendants cannot influence any later move. Ownership is
      // already represented by their cell in the parent's evaluation.
      const newScore = newStatus === 0
        ? newKey === oldKey
          ? oldScore + scoreDelta
          : LUT_SCORE_BASE4[newKey] * this.layerWeights[d] + this.childScores[d][pIdx]
        : 0
      this.subtreeScores[d][pIdx] = newScore
      scoreDelta = newScore - oldScore
      currentIdx = pIdx
    }
    return highestWonLayer
  }

  // Adapter imports can install explicit closed-node statuses directly.
  public rebuildEvaluation (): void {
    for (let d = this.depth - 1; d >= 0; d--) {
      for (let i = 0; i < this.keys[d].length; i++) {
        const key = this.keys[d][i]
        const status = this.getNodeStatus(d, i)
        let childScore = 0
        let possibleKey = 0
        for (let child = 0; child < 9; child++) {
          const childStatus = (key >>> (child * 2)) & 3
          let possible = childStatus === CELL_DRAW ? 0 : childStatus
          if (d === this.depth - 1) {
            if (childStatus === 0) possible = 3
          } else {
            const childIdx = i * 9 + child
            childScore += this.subtreeScores[d + 1][childIdx]
            if (childStatus === 0) possible = this.possibleWins[d + 1][childIdx]
          }
          possibleKey |= possible << (child * 2)
        }
        this.childScores[d][i] = childScore
        this.possibleKeys[d][i] = possibleKey
        this.possibleWins[d][i] = status === 0
          ? LUT_POSSIBLE_WIN_BASE4[possibleKey]
          : status === CELL_DRAW ? 0 : status
        this.subtreeScores[d][i] = status === 0
          ? LUT_SCORE_BASE4[key] * this.layerWeights[d] + childScore
          : 0
      }
    }
  }

  public getWinner (): number {
    if (this.rootWinner !== 0) return this.rootWinner
    const winner = LUT_WIN_STATUS_BASE4[this.keys[0][0]]
    if (winner !== 0) return winner
    return this.possibleWins[0][0] === 0 ? CELL_DRAW : 0
  }

  public getNodeStatus (layer: number, nodeIdx: number): number {
    if (layer === 0 && this.rootWinner !== 0) return this.rootWinner
    if (layer > 0) {
      const parentKey = this.keys[layer - 1][(nodeIdx / 9) >>> 0]
      const importedStatus = (parentKey >>> ((nodeIdx % 9) * 2)) & 3
      if (importedStatus !== 0) return importedStatus
    }
    return LUT_WIN_STATUS_BASE4[this.keys[layer][nodeIdx]]
  }

  public isPlayableNode (layer: number, nodeIdx: number): boolean {
    if (layer < 0 || layer >= this.depth || nodeIdx < 0 || nodeIdx >= this.keys[layer].length) return false
    for (let d = layer; d >= 0; d--) {
      if (this.getNodeStatus(d, nodeIdx) !== 0) return false
      nodeIdx = (nodeIdx / 9) >>> 0
    }
    return this.rootWinner === 0
  }

  public normalizeConstraint (): void {
    let layer = this.constraintLayer
    let nodeIdx = this.constraint
    if (nodeIdx < 0) {
      this.constraint = -1
      this.constraintLayer = -1
      return
    }
    while (layer >= 0 && !this.isPlayableNode(layer, nodeIdx)) {
      nodeIdx = (nodeIdx / 9) >>> 0
      layer--
    }
    this.constraint = layer <= 0 ? -1 : nodeIdx
    this.constraintLayer = layer <= 0 ? -1 : layer
  }

  public evaluate (player: number): number {
    const ceiling = this.depth === 4 ? 89000 : 50000
    const rawScore = Math.max(-ceiling, Math.min(ceiling, this.subtreeScores[0][0]))
    // Fractional deep-board weights must round identically after swapping X/O.
    let score = rawScore < 0 ? -Math.round(-rawScore) : Math.round(rawScore)
    if (player === CELL_O) score = -score
    if (this.constraint === -1) score += 20
    return score === 0 ? 0 : score
  }

  public clone (): Board {
    const copy = new Board(this.depth)
    copy.leaves.set(this.leaves)
    for (let d = 0; d < this.depth; d++) {
      copy.keys[d].set(this.keys[d])
      copy.subtreeScores[d].set(this.subtreeScores[d])
      copy.childScores[d].set(this.childScores[d])
      copy.possibleKeys[d].set(this.possibleKeys[d])
      copy.possibleWins[d].set(this.possibleWins[d])
    }
    copy.constraint = this.constraint
    copy.constraintLayer = this.constraintLayer
    copy.hashLow = this.hashLow
    copy.hashHigh = this.hashHigh
    copy.rootWinner = this.rootWinner
    return copy
  }
}
