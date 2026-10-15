export type TTFlag = 'exact' | 'lower' | 'upper'

export interface TTEntry {
  depth: number
  score: number
  flag: TTFlag
  bestMove: number
}

// 34 MiB per worker: full 64-bit identities, packed results and replacement age.
const TABLE_SIZE = 2 * 1024 * 1024

export class TT {
  keys: Uint32Array
  values: Int32Array
  generations: Uint8Array
  mask: number
  generation = 1

  constructor (size = TABLE_SIZE) {
    let realSize = 1
    while (realSize < size) realSize *= 2
    this.keys = new Uint32Array(realSize * 2)
    this.values = new Int32Array(realSize * 2)
    this.generations = new Uint8Array(realSize)
    this.mask = realSize - 1
  }

  put (
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: number
  ) {
    this.putParts(Number(hash & 0xffffffffn), Number(hash >> 32n), depth, score, flag, bestMove)
  }

  putParts (
    low: number,
    high: number,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: number
  ) {
    const index = low & this.mask
    const slot = index * 2
    if (this.generations[index] === this.generation) {
      const existingDepth = (this.values[slot + 1] >>> 2) & 0xff
      if (depth < existingDepth) return
      // An exact entry at this depth is more useful than a later bound.
      if (depth === existingDepth && (this.values[slot + 1] & 3) === 0 && flag !== 'exact' &&
        this.keys[slot] === (low >>> 0) && this.keys[slot + 1] === (high >>> 0)) return
    }
    this.keys[slot] = low
    this.keys[slot + 1] = high
    this.generations[index] = this.generation
    this.values[slot] = score
    const flagValue = flag === 'lower' ? 1 : flag === 'upper' ? 2 : 0
    this.values[slot + 1] = ((bestMove === -1 ? 65535 : bestMove) << 10) | (depth << 2) | flagValue
  }

  get (hash: bigint): TTEntry | undefined {
    const index = this.getIndex(hash)
    if (index === -1) return undefined
    const packed = this.values[index * 2 + 1]
    const rawMove = (packed >>> 10) & 0xffff
    const flag = packed & 3
    return {
      depth: (packed >>> 2) & 0xff,
      score: this.values[index * 2],
      flag: flag === 1 ? 'lower' : flag === 2 ? 'upper' : 'exact',
      bestMove: rawMove === 65535 ? -1 : rawMove,
    }
  }

  getIndex (hash: bigint): number {
    return this.getIndexParts(Number(hash & 0xffffffffn), Number(hash >> 32n))
  }

  getIndexParts (low: number, high: number): number {
    const index = low & this.mask
    const slot = index * 2
    return this.generations[index] !== 0 && this.keys[slot] === (low >>> 0) &&
      this.keys[slot + 1] === (high >>> 0)
      ? index
      : -1
  }

  newSearch () {
    this.generation++
    if (this.generation > 255) {
      this.generations.fill(0)
      this.generation = 1
    }
  }

  clear () {
    // Occupancy is independent of the key, including the valid all-zero hash.
    this.generations.fill(0)
    this.generation = 1
  }

  size () {
    return this.generations.length
  }
}

export const tt = new TT()
