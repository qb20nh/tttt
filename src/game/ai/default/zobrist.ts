export const ZOBRIST_TABLE = new BigUint64Array(6561 * 4) // Depth 4 max (9^4 cells) * 4 states
// We only need 3 states actually (Empty, X, O). Draw is not a leaf state.
// But setCell val is 0,1,2.
// Index = cellIdx * 4 + val.

// Random generator
function rand64 (): bigint {
  const low = Math.floor(Math.random() * 0x100000000)
  const high = Math.floor(Math.random() * 0x100000000)
  return (BigInt(high) << 32n) | BigInt(low)
}

for (let i = 0; i < ZOBRIST_TABLE.length; i++) {
  ZOBRIST_TABLE[i] = rand64()
}

export const ZOBRIST_SIDE = rand64()

// Identical leaf positions have different legal moves at different board and
// constraint depths, so both belong to the transposition identity.
export const ZOBRIST_DEPTH = Array.from({ length: 5 }, rand64)
export const ZOBRIST_CONSTRAINT_LAYER = Array.from({ length: 5 }, rand64)

// Zobrist table for constraint values
// Max constraint index for D=4 at layer D-1 is 9^(D-1) = 729
// At layer D-2: 9^(D-2) = 81, etc.
// We use modulo to map any constraint to a fixed range for hashing
export const ZOBRIST_CONSTRAINT_SIZE = 1024 // Power of 2 for fast modulo
export const ZOBRIST_CONSTRAINT = new BigUint64Array(ZOBRIST_CONSTRAINT_SIZE)
for (let i = 0; i < ZOBRIST_CONSTRAINT.length; i++) {
  ZOBRIST_CONSTRAINT[i] = rand64()
}

// JavaScript bitwise operations use 32-bit numbers. Split each 64-bit key once
// at initialization so make/unmake and TT probes avoid BigInt arithmetic.
function splitKeys (keys: ArrayLike<bigint>): [Uint32Array, Uint32Array] {
  const low = new Uint32Array(keys.length)
  const high = new Uint32Array(keys.length)
  for (let i = 0; i < keys.length; i++) {
    low[i] = Number(keys[i] & 0xffffffffn)
    high[i] = Number(keys[i] >> 32n)
  }
  return [low, high]
}

export const [ZOBRIST_TABLE_LOW, ZOBRIST_TABLE_HIGH] = splitKeys(ZOBRIST_TABLE)
export const [ZOBRIST_CONSTRAINT_LOW, ZOBRIST_CONSTRAINT_HIGH] = splitKeys(ZOBRIST_CONSTRAINT)
export const [ZOBRIST_DEPTH_LOW, ZOBRIST_DEPTH_HIGH] = splitKeys(ZOBRIST_DEPTH)
export const [ZOBRIST_CONSTRAINT_LAYER_LOW, ZOBRIST_CONSTRAINT_LAYER_HIGH] = splitKeys(ZOBRIST_CONSTRAINT_LAYER)
export const ZOBRIST_SIDE_LOW = Number(ZOBRIST_SIDE & 0xffffffffn)
export const ZOBRIST_SIDE_HIGH = Number(ZOBRIST_SIDE >> 32n)
