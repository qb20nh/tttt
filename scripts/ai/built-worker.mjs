import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { loadEngine, newState, advance, legalMoves, moveOf, random, repository } from './harness.mjs'

// Exercise the script actually referenced by the optimized production bundle,
// including filename mangling, asset pruning and JavaScript compression.
const assets = join(repository, 'dist/_astro')
const targets = new Set()
for (const file of readdirSync(assets)) {
  if (!file.endsWith('.js')) continue
  const source = readFileSync(join(assets, file), 'utf8')
  for (const match of source.matchAll(/new Worker\("([^"]+)"/g)) targets.add(match[1])
}
assert.equal(targets.size, 1, 'production bundle should reference one AI worker script')
const target = [...targets][0]
const file = target.slice(target.indexOf('/_astro/') + 1)
assert(file.startsWith('_astro/'), 'worker asset must live under the build output')
const responses = []
const self = { postMessage: value => responses.push(value), onmessage: null }
runInNewContext(readFileSync(join(repository, 'dist', file), 'utf8'), { self, performance, console })
assert.equal(typeof self.onmessage, 'function', 'built worker must register its message handler')
const rules = loadEngine()
const rng = random(20270327)
let requests = 0
const search = (state, budget = 2, maxDepth = 6) => {
  const id = ++requests
  self.onmessage({ data: { type: 'search', id, board: state.root, player: state.player === 1 ? 'X' : 'O', constraint: state.constraint, config: { boardDepth: state.depth, maxTime: budget, maxDepth } } })
  const response = responses.at(-1)
  assert.equal(response.id, id)
  assert.equal(response.type, 'result')
  const path = Array.from(response.result.move)
  if (state.root.winner) assert.deepEqual(path, [])
  else assert(legalMoves(rules, state).includes(moveOf(path)), 'built worker must return a legal move')
  return { ...response.result, move: path }
}
for (const depth of [2, 3, 4]) {
  let state = newState(rules, depth)
  for (let ply = 0; ply < 4; ply++) {
    search(state)
    const moves = legalMoves(rules, state)
    state = advance(rules, state, moves[Math.floor(rng() * moves.length)])
  }
}
for (const winner of ['X', 'O', 'Draw']) {
  const state = newState(rules, 2)
  state.root.winner = winner
  search(state)
}
const tactical = newState(rules, 1)
for (const move of [0, 1]) tactical.root.children[move].value = 'X'
for (const move of [3, 7]) tactical.root.children[move].value = 'O'
assert.deepEqual(search(tactical, 100, 1).move, [2], 'built worker must take an immediate winning move')
console.log(JSON.stringify({ passed: true, workerAsset: target, requests }))
