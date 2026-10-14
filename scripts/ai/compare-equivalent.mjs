import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  loadEngine, newState, random, treeLegalMoves, legalMoves, advance,
  boardOf, snapshot, argument, report,
} from './harness.mjs'

const baselinePath = argument('baseline', '')
assert(typeof baselinePath === 'string' && baselinePath.length > 0 && !baselinePath.startsWith('--'), '--baseline is required')
const roots = [resolve(baselinePath), resolve(argument('engine', '.'))]
const repeats = Number(argument('repeats', '9'))
const seed = Number(argument('seed', '20261014'))
assert(Number.isInteger(repeats) && repeats > 0, '--repeats must be a positive integer')
assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, '--seed must be an unsigned 32-bit integer')

const engines = roots.map(root => loadEngine(root))
const rules = engines[1]
const positions = []
let publicOracleChecks = 0
for (const depth of [2, 3, 4]) {
  const targets = [5, Math.floor(9 ** depth * 0.15), Math.floor(9 ** depth * 0.4)]
  const rng = random(seed + depth * 1009)
  let state = newState(rules, depth)
  for (let ply = 0; ply <= targets.at(-1); ply++) {
    if (targets.includes(ply)) {
      const legal = treeLegalMoves(state)
      assert.deepEqual(legal, legalMoves(rules, state), 'sample traversal must match public game legality')
      assert(legal.length, `D${depth} sample is terminal; choose a different --seed`)
      publicOracleChecks++
      positions.push({ name: `D${depth}-ply${ply}`, searchDepth: depth === 4 ? 6 : 7, state: structuredClone(state), legal })
    }
    if (ply === targets.at(-1)) break
    const moves = treeLegalMoves(state)
    assert(moves.length, `D${depth} trajectory ended before its samples; choose a different --seed`)
    // Public advance validates every selected path independently of the AI.
    state = advance(rules, state, moves[Math.floor(rng() * moves.length)], { copy: false })
  }
}

function fullSnapshot (board) {
  return {
    ...snapshot(board),
    depth: board.depth,
    rootWinner: board.rootWinner,
    hashLow: board.hashLow,
    hashHigh: board.hashHigh,
    powers: [...board.powers],
    layerWeights: [...board.layerWeights],
    ...Object.fromEntries(['subtreeScores', 'childScores', 'possibleKeys', 'possibleWins'].map(field => [field, board[field].map(layer => [...layer])])),
  }
}

function median (values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const warmups = 3
const results = []
for (const position of positions) {
  const boards = engines.map(engine => boardOf(engine, position.state))
  const snapshots = boards.map(fullSnapshot)
  const runs = engines.map(() => [])
  const answers = []
  function run (index, record) {
    const engine = engines[index]
    engine.tt.clear()
    const search = new engine.Search()
    const started = performance.now()
    const result = search.alphaBeta(boards[index], position.state.player, position.searchDepth, -Infinity, Infinity, 0, false)
    const elapsed = performance.now() - started
    const answer = { ...result, nodes: search.nodesVisited }
    assert.deepEqual(fullSnapshot(boards[index]), snapshots[index], `${position.name}: search must restore every Board cache`)
    assert(position.legal.includes(answer.move), `${position.name}: search must return a move legal under public game rules`)
    if (!answers[index]) answers[index] = answer
    else assert.deepEqual(answer, answers[index], `${position.name}: repeated searches must be deterministic`)
    assert.deepEqual(answer, answers[0], `${position.name}: score, move and node count must match the baseline`)
    if (record) runs[index].push(elapsed)
  }
  // Fresh Search and cleared TT isolate each run; warm-up is never timed data.
  for (let warm = 0; warm < warmups; warm++) {
    for (let index = 0; index < engines.length; index++) run(index, false)
  }
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let step = 0; step < engines.length; step++) run((step + repeat) % engines.length, true)
  }
  const medianMs = runs.map(median)
  const speedups = medianMs.map(value => medianMs[0] / value)
  results.push({ position: position.name, searchDepth: position.searchDepth, answers, medianMs, speedups, runs })
  console.error(`${position.name}: ${JSON.stringify({ medianMs, speedups })}`)
}
const geometricSpeedup = roots.map((_, index) => Math.exp(results.reduce((sum, result) => sum + Math.log(result.speedups[index]), 0) / results.length))
report({ versions: ['baseline', 'current'], roots, repeats, seed, warmups, publicOracleChecks, results, geometricSpeedup })
