import assert from 'node:assert/strict'
import { loadEngine, newState, boardOf, legalMoves, snapshot, report } from './harness.mjs'

// Both copies contain the current engine; only the root symmetry gate differs.
const engines = { pruned: loadEngine(), full: loadEngine() }
const positions = [[2, 8], [3, 7], [4, 6]]
const repeats = 3

function run (mode, boardDepth, searchDepth) {
  const engine = engines[mode]
  engine.tt.clear()
  const state = newState(engine, boardDepth)
  const board = boardOf(engine, state)
  const before = snapshot(board)
  const legal = legalMoves(engine, state)
  const search = new engine.Search()
  if (mode === 'full') {
    search.setOpeningMoves = () => { search.openingMoves = null }
  }

  const started = performance.now()
  const result = search.alphaBeta(board, state.player, searchDepth, -Infinity, Infinity, 0, false)
  const elapsed = performance.now() - started
  assert.deepEqual(snapshot(board), before, 'fixed-depth search must restore the input board')
  assert(legal.includes(result.move), 'fixed-depth search must return a legal opening move')
  const rootMoves = search.openingMoves?.length ?? legal.length
  assert.equal(rootMoves, mode === 'pruned' ? engine.symmetry.getOpeningMoves(boardDepth).length : legal.length)
  return { elapsed, nodes: search.nodesVisited, score: result.score, move: result.move, rootMoves }
}

// Exclude shallow runs that warm each isolated module's search and board code.
for (const [boardDepth] of positions) {
  const pruned = run('pruned', boardDepth, 2)
  const full = run('full', boardDepth, 2)
  assert.equal(pruned.score, full.score, 'symmetry pruning must preserve the shallow opening score')
}

const results = []
for (const [boardDepth, searchDepth] of positions) {
  const runs = []
  for (let repeat = 0; repeat < repeats; repeat++) {
    const order = repeat % 2 === 0 ? ['pruned', 'full'] : ['full', 'pruned']
    const pair = {}
    for (const mode of order) {
      const result = run(mode, boardDepth, searchDepth)
      pair[mode] = result
      runs.push({ repeat: repeat + 1, mode, ...result })
      console.error(`D${boardDepth} depth ${searchDepth}, repeat ${repeat + 1} ${mode}: ${result.elapsed.toFixed(2)}ms / ${result.nodes} nodes / ${result.rootMoves} root moves`)
    }
    assert.equal(pair.pruned.score, pair.full.score, 'symmetry pruning must preserve the exact fixed-depth opening score')
  }
  const median = mode => runs.filter(run => run.mode === mode).map(run => run.elapsed).sort((a, b) => a - b)[1]
  const medianTimeMs = { pruned: median('pruned'), full: median('full') }
  results.push({
    boardDepth,
    searchDepth,
    rootMoves: { pruned: runs.find(run => run.mode === 'pruned').rootMoves, full: runs.find(run => run.mode === 'full').rootMoves },
    medianTimeMs,
    speedup: medianTimeMs.full / medianTimeMs.pruned,
    runs,
  })
}
report({ repeats, results })
