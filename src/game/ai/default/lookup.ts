import {
  CELL_EMPTY,
  CELL_X,
  CELL_O,
  CELL_DRAW,
  WIN_PATTERNS,
} from './constants'

export const TABLE_SIZE = 19683 // 3^9
export const POW4 = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536]

const KEY_COUNT = 1 << 18
export const LUT_WIN_STATUS_BASE4 = new Uint8Array(KEY_COUNT)
export const LUT_SCORE_BASE4 = new Int16Array(KEY_COUNT)
export const LUT_EMPTY_MASK_BASE4 = new Uint16Array(KEY_COUNT)
export const LUT_WIN_MOVES_X = new Uint16Array(KEY_COUNT)
export const LUT_WIN_MOVES_O = new Uint16Array(KEY_COUNT)
// Here each child uses a possibility mask: 1 = X, 2 = O, 3 = both.
export const LUT_POSSIBLE_WIN_BASE4 = new Uint8Array(KEY_COUNT)

export const SCORE_WIN = 1000
export const SCORE_NEAR_X = 100
export const SCORE_NEAR_O = -100
export const SCORE_ADV_X = 10
export const SCORE_ADV_O = -10

let initialized = false

export function initTables () {
  if (initialized) return

  const patterns = WIN_PATTERNS.map(([a, b, c]) => (1 << a) | (1 << b) | (1 << c))
  const popcount = new Uint8Array(512)
  for (let mask = 1; mask < popcount.length; mask++) popcount[mask] = popcount[mask >>> 1] + (mask & 1)
  const centerMask = 1 << 4
  const cornerMask = (1 << 0) | (1 << 2) | (1 << 6) | (1 << 8)

  for (let key = 0; key < KEY_COUNT; key++) {
    let empty = 0
    let x = 0
    let o = 0
    let drawn = 0
    for (let j = 0; j < 9; j++) {
      const val = (key >>> (j * 2)) & 3
      if (val === CELL_EMPTY) empty |= 1 << j
      else if (val === CELL_X) x |= 1 << j
      else if (val === CELL_O) o |= 1 << j
      else drawn |= 1 << j
    }
    LUT_EMPTY_MASK_BASE4[key] = empty

    let winner = CELL_EMPTY
    let possibilities = 0
    for (const pattern of patterns) {
      if (winner === CELL_EMPTY) {
        if ((x & pattern) === pattern) winner = CELL_X
        else if ((o & pattern) === pattern) winner = CELL_O
      }
      if (((x | drawn) & pattern) === pattern) possibilities |= CELL_X
      if (((o | drawn) & pattern) === pattern) possibilities |= CELL_O
    }
    LUT_POSSIBLE_WIN_BASE4[key] = possibilities
    if (winner === CELL_EMPTY && empty === 0) winner = CELL_DRAW
    LUT_WIN_STATUS_BASE4[key] = winner

    let score = 0
    let xWins = 0
    let oWins = 0
    if (winner === CELL_X) score = SCORE_WIN
    else if (winner === CELL_O) score = -SCORE_WIN
    else if (winner === CELL_EMPTY) {
      for (const pattern of patterns) {
        // A drawn child blocks the line for both players.
        if (drawn & pattern) continue
        const cx = popcount[x & pattern]
        const co = popcount[o & pattern]
        if (co === 0) {
          if (cx === 2) {
            score += SCORE_NEAR_X
            xWins |= pattern & empty
          } else if (cx === 1) score += SCORE_ADV_X
        }
        if (cx === 0) {
          if (co === 2) {
            score += SCORE_NEAR_O
            oWins |= pattern & empty
          } else if (co === 1) score += SCORE_ADV_O
        }
      }

      if (x & centerMask) score += 5
      else if (o & centerMask) score -= 5
      score += 2 * (popcount[x & cornerMask] - popcount[o & cornerMask])
    }
    LUT_WIN_MOVES_X[key] = xWins
    LUT_WIN_MOVES_O[key] = oWins
    LUT_SCORE_BASE4[key] = score
  }
  initialized = true
}
