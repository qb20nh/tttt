import {
  initTables,
  LUT_WIN_STATUS_BASE4,
  LUT_SCORE_BASE4,
  LUT_WIN_MOVES_X,
  LUT_WIN_MOVES_O,
} from './lookup'

initTables()

// Store only the 3^9 ordinary boards; imported Draw cells use the exact fallback.
export const LUT_ORDER_KEY_INDEX = new Uint16Array(1 << 18).fill(65535)
export const LUT_ORDER_RANK = new Uint16Array(19683 * 9)

// Input is normalized to X: empty and Draw markers retain their identities.
// The high bit records a local win; the low 15 bits contain the static score.
export function computeOrderRank (key: number, relative: number): number {
  const bit = 1 << relative
  const nextKey = key | (1 << (relative * 2))
  const localWin = (LUT_WIN_MOVES_X[key] & bit) !== 0
  let score = 2000
  if (localWin) score += 8000
  if (LUT_WIN_MOVES_O[key] & bit) score += 4000
  if (LUT_WIN_STATUS_BASE4[nextKey] === 3) score += 50
  const delta = LUT_SCORE_BASE4[nextKey] - LUT_SCORE_BASE4[key]
  score += Math.max(-200, Math.min(200, delta))
  if (relative === 4) score += 30
  else if ((relative & 1) === 0) score += 12
  return score | (localWin ? 0x8000 : 0)
}

for (let index = 0; index < 19683; index++) {
  let value = index
  let key = 0
  for (let relative = 0; relative < 9; relative++) {
    key |= (value % 3) << (relative * 2)
    value = (value / 3) >>> 0
  }
  LUT_ORDER_KEY_INDEX[key] = index
  for (let relative = 0; relative < 9; relative++) {
    if (((key >>> (relative * 2)) & 3) !== 0) continue
    LUT_ORDER_RANK[index * 9 + relative] = computeOrderRank(key, relative)
  }
}
