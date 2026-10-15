import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argument, loadEngine, report } from './harness.mjs'

// Derive line order from the 3x3 geometry rather than the production masks.
// Rows precede columns and diagonals, including for impossible dual-win keys.
const lines = []
for (let row = 0; row < 3; row++) lines.push([row * 3, row * 3 + 1, row * 3 + 2])
for (let column = 0; column < 3; column++) lines.push([column, column + 3, column + 6])
lines.push([0, 4, 8], [2, 4, 6])

const tableTypes = {
  LUT_WIN_STATUS_BASE4: Uint8Array,
  LUT_SCORE_BASE4: Int16Array,
  LUT_EMPTY_MASK_BASE4: Uint16Array,
  LUT_WIN_MOVES_X: Uint16Array,
  LUT_WIN_MOVES_O: Uint16Array,
  LUT_POSSIBLE_WIN_BASE4: Uint8Array,
}

export function validateLookupTables (engine) {
  const started = performance.now()
  const lookup = engine.lookup
  const constants = {
    TABLE_SIZE: 19683,
    POW4: [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536],
    SCORE_WIN: 1000,
    SCORE_NEAR_X: 100,
    SCORE_NEAR_O: -100,
    SCORE_ADV_X: 10,
    SCORE_ADV_O: -10,
  }
  for (const [name, expected] of Object.entries(constants)) assert.deepEqual(lookup[name], expected, `lookup constant ${name} must preserve its rule value`)
  const keyCount = 4 ** 9
  const expectedTables = {}
  for (const [name, Type] of Object.entries(tableTypes)) {
    assert(lookup[name] instanceof Type, `${name} must retain ${Type.name} storage`)
    assert.equal(lookup[name].length, keyCount, `${name} must cover every base-4 board`)
    expectedTables[name] = new Type(keyCount)
  }
  lookup.initTables()
  const cells = new Array(9)
  for (let key = 0; key < keyCount; key++) {
    let encoded = key
    let emptyMask = 0
    for (let cell = 0; cell < 9; cell++) {
      cells[cell] = encoded % 4
      encoded = Math.floor(encoded / 4)
      if (cells[cell] === 0) emptyMask += 2 ** cell
    }

    let winner = 0
    let possible = 0
    for (const line of lines) {
      const first = cells[line[0]]
      if (winner === 0 && (first === 1 || first === 2) && line.every(cell => cells[cell] === first)) winner = first
      // Possibility input is a separate domain: 3 permits both players and
      // 0 permits neither. Ordinary Draw cells still block scored lines below.
      if (line.every(cell => cells[cell] === 1 || cells[cell] === 3)) possible |= 1
      if (line.every(cell => cells[cell] === 2 || cells[cell] === 3)) possible |= 2
    }
    if (winner === 0 && emptyMask === 0) winner = 3

    let score = winner === 1 ? 1000 : winner === 2 ? -1000 : 0
    let xWins = 0
    let oWins = 0
    if (winner === 0) {
      for (const line of lines) {
        if (line.some(cell => cells[cell] === 3)) continue
        let xCount = 0
        let oCount = 0
        let emptyLine = 0
        for (const cell of line) {
          if (cells[cell] === 1) xCount++
          else if (cells[cell] === 2) oCount++
          else emptyLine += 2 ** cell
        }
        if (oCount === 0 && xCount === 2) {
          score += 100
          xWins |= emptyLine
        } else if (oCount === 0 && xCount === 1) score += 10
        if (xCount === 0 && oCount === 2) {
          score -= 100
          oWins |= emptyLine
        } else if (xCount === 0 && oCount === 1) score -= 10
      }
      if (cells[4] === 1) score += 5
      else if (cells[4] === 2) score -= 5
      for (const corner of [0, 2, 6, 8]) {
        if (cells[corner] === 1) score += 2
        else if (cells[corner] === 2) score -= 2
      }
    }
    expectedTables.LUT_WIN_STATUS_BASE4[key] = winner
    expectedTables.LUT_SCORE_BASE4[key] = score
    expectedTables.LUT_EMPTY_MASK_BASE4[key] = emptyMask
    expectedTables.LUT_WIN_MOVES_X[key] = xWins
    expectedTables.LUT_WIN_MOVES_O[key] = oWins
    expectedTables.LUT_POSSIBLE_WIN_BASE4[key] = possible
  }

  const compare = () => {
    for (const [name, expected] of Object.entries(expectedTables)) {
      const actual = lookup[name]
      for (let key = 0; key < keyCount; key++) {
        if (actual[key] !== expected[key]) throw new Error(`${name}[${key}]: expected ${expected[key]}, received ${actual[key]}`)
      }
    }
  }
  compare()
  const references = Object.keys(tableTypes).map(name => lookup[name])
  lookup.initTables()
  for (const [index, name] of Object.keys(tableTypes).entries()) assert.equal(lookup[name], references[index], 'repeated initialization must preserve table identities')
  compare()
  return {
    passed: true,
    elapsedMs: performance.now() - started,
    counts: { keys: keyCount, tables: Object.keys(tableTypes).length, entries: keyCount * Object.keys(tableTypes).length, constants: Object.keys(constants).length, idempotenceEntries: keyCount * Object.keys(tableTypes).length },
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  report(validateLookupTables(loadEngine(resolve(argument('engine', '.')))))
}
