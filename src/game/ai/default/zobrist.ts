export const ZOBRIST_TABLE = new BigUint64Array(6561 * 4) // Depth 4 max (9^4 cells) * 4 states
// We only need 3 states actually (Empty, X, O). Draw is not a leaf state.
// But setCell val is 0,1,2.
// Index = cellIdx * 4 + val.

// Random generator
function rand64 (): bigint {
  let h = 0n
  for (let i = 0; i < 8; i++) {
    h = (h << 8n) | BigInt(Math.floor(Math.random() * 256))
  }
  return h
}

for (let i = 0; i < ZOBRIST_TABLE.length; i++) {
  ZOBRIST_TABLE[i] = rand64()
}

export const ZOBRIST_SIDE = rand64()

// Zobrist table for constraint values
// Max constraint index for D=4 at layer D-1 is 9^(D-1) = 729
// At layer D-2: 9^(D-2) = 81, etc.
// We use modulo to map any constraint to a fixed range for hashing
export const ZOBRIST_CONSTRAINT_SIZE = 1024 // Power of 2 for fast modulo
export const ZOBRIST_CONSTRAINT = new BigUint64Array(ZOBRIST_CONSTRAINT_SIZE)
for (let i = 0; i < ZOBRIST_CONSTRAINT.length; i++) {
  ZOBRIST_CONSTRAINT[i] = rand64()
}
