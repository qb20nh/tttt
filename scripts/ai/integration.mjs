import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { loadEngine, newState, advance, legalMoves, moveOf, repository } from './harness.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const engine = loadEngine()
const responses = []
globalThis.self = { postMessage: value => responses.push(value), onmessage: null }
require(join(engine.output, 'src/game/ai/worker.js'))
const search = (state, id = 1, maxTime = 80, maxDepth = 5) => {
  globalThis.self.onmessage({ data: { type: 'search', id, board: state.root, player: state.player === 1 ? 'X' : 'O', constraint: state.constraint, config: { maxTime, maxDepth, boardDepth: state.depth } } })
  const response = responses.at(-1)
  assert.equal(response.type, 'result')
  assert.equal(response.id, id)
  assert(response.result.time >= 0)
  if (state.root.winner) assert.deepEqual(response.result.move, [])
  else assert(legalMoves(engine, state).includes(moveOf(response.result.move)))
  return response.result
}
const firstState = advance(engine, newState(engine, 2), 0)
const cold = search(firstState, 11, 500, 5)
const warm = search(firstState, 12, 500, 5)
assert(warm.nodes < cold.nodes, 'identical-position warm search must reuse transposition data')
assert.deepEqual(warm.move, cold.move)
for (const depth of [1, 2, 3, 4]) search(newState(engine, depth), 20 + depth, 0, 20)
for (const winner of ['X', 'O', 'Draw']) {
  const state = newState(engine, 2)
  state.root.winner = winner
  search(state, 30, 5, 5)
}
globalThis.self.onmessage({ data: { type: 'clear' } })
// A bad search return exercises the public worker validation and legal fallback.
const originalSearch = engine.Search.prototype.search
const originalError = console.error
const diagnostics = []
console.error = (...args) => diagnostics.push(args)
engine.Search.prototype.search = () => ({ move: 0, score: 0, nodes: 1, depth: 1 })
search(firstState, 40, 0, 1)
assert(diagnostics.some(args => args[0].includes('invalid move')))
engine.Search.prototype.search = () => { throw new Error('test search failure') }
search(firstState, 41, 0, 1)
assert(diagnostics.some(args => args[0].includes('Search Error')))
engine.Search.prototype.search = originalSearch
console.error = originalError

const made = []
class FakeWorker {
  constructor () { this.listeners = []; this.messages = []; this.terminated = false; this.onmessage = null; made.push(this) }
  postMessage (message, options) { if (this.fail) throw new Error('post failed'); this.messages.push({ message, options }) }
  addEventListener (type, listener) { if (type === 'message') this.listeners.push(listener) }
  terminate () { this.terminated = true }
  emit (data) { const event = { data }; for (const listener of this.listeners) listener(event); this.onmessage?.(event) }
}
const module = { exports: {} }
const source = ts.transpileModule(readFileSync(join(repository, 'src/game/ai/worker-pool.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
runInNewContext(source, { module, exports: module.exports, require: name => { assert.equal(name, './worker?worker'); return { default: FakeWorker } } })
const pool = module.exports
pool.preloadAiWorkers()
assert.equal(made.length, 1, 'preload should allocate one shared engine')
pool.preloadAiWorkers()
assert.equal(made.length, 1, 'preload should be idempotent')
const one = pool.acquireAiWorker()
assert.equal(made.length, 1, 'first owner should reuse the preloaded worker')
const two = pool.acquireAiWorker()
assert.equal(made.length, 2, 'a concurrent owner should allocate the second worker on demand')
assert.equal(pool.acquireAiWorker(), null)
pool.releaseAiWorker(one)
assert.equal(one.terminated, false)
assert.equal(pool.acquireAiWorker(), one)
one.postMessage({ type: 'search', id: 1 })
pool.releaseAiWorker(one)
assert.equal(one.terminated, true, 'released abandoned search must terminate')
const replacement = pool.acquireAiWorker()
assert.notEqual(replacement, one)
assert.equal(made.length, 3)
replacement.postMessage({ type: 'search', id: 2 }, [])
replacement.emit({ type: 'result', id: 2 })
pool.releaseAiWorker(replacement)
assert.equal(replacement.terminated, false, 'completed search should retain warm worker')
assert.equal(pool.acquireAiWorker(), replacement)
replacement.postMessage({ type: 'search', id: 3 })
replacement.postMessage({ type: 'search', id: 4 })
replacement.emit({ type: 'result', id: 3 })
pool.releaseAiWorker(replacement)
assert.equal(replacement.terminated, true, 'queued outstanding searches must terminate')
const failed = pool.acquireAiWorker()
failed.fail = true
assert.throws(() => failed.postMessage({ type: 'search' }))
pool.releaseAiWorker(failed)
assert.equal(failed.terminated, false, 'failed post must roll back pending count')
failed.fail = false
pool.clearAiWorkers()
assert.equal(two.messages.at(-1).message.type, 'clear')
pool.releaseAiWorker(two)
assert.equal(two.terminated, false, 'clear messages do not count as active searches')

// Exercise the actual game hook's effect order and message handler without a
// browser renderer. State updates, dependency changes and cleanup retain the
// normal hook contract; the real worker processes the emitted game requests.
function mountGame (savedState) {
  const created = []
  class GameWorker extends FakeWorker {
    constructor () { super(); created.push(this) }
  }
  const gamePoolModule = { exports: {} }
  runInNewContext(source, {
    module: gamePoolModule,
    exports: gamePoolModule.exports,
    require: () => ({ default: GameWorker }),
  })
  const slots = []
  const timers = []
  let cursor = 0
  let effects = []
  let dirty = true
  let output
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState (initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => {
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true }
      }]
    },
    useRef (initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback (callback, deps) {
      const index = cursor++
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { value: callback, deps }
      return slots[index].value
    },
    useEffect (callback, deps) {
      const index = cursor++
      if (!sameDeps(slots[index]?.deps, deps)) effects.push({ index, callback, deps })
    },
  }
  const gameModule = { exports: {} }
  const gameSource = ts.transpileModule(readFileSync(join(repository, 'src/game/engine.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(gameSource, {
    module: gameModule,
    exports: gameModule.exports,
    require: name => {
      if (name === 'react') return hooks
      if (name === './logic') return engine.logic
      if (name === './constants') return require(join(engine.output, 'src/game/constants.js'))
      if (name === './persistence') return { loadGameState: () => savedState, clearSavedState () {}, saveGameState () {} }
      if (name === './ai/worker-pool') return gamePoolModule.exports
      throw new Error(`Unexpected game import: ${name}`)
    },
    performance,
    console,
    setTimeout: callback => { timers.push(callback); return timers.length },
    window: { addEventListener () {}, removeEventListener () {} },
    document: { addEventListener () {}, removeEventListener () {} },
  })
  const flush = () => {
    for (let renders = 0; dirty; renders++) {
      assert(renders < 20, 'game hook should settle after state updates')
      dirty = false
      cursor = 0
      effects = []
      output = gameModule.exports.useGameState(2, true)
      for (const { index, callback, deps } of effects) {
        slots[index]?.cleanup?.()
        slots[index] = { deps, cleanup: callback() }
      }
    }
    return output
  }
  return {
    created,
    timers,
    flush,
    get game () { return output },
    flushTimers () { for (const callback of timers.splice(0)) callback(); return flush() },
    unmount () { for (const slot of slots) slot?.cleanup?.() },
  }
}

const processGameRequest = (worker, request) => {
  globalThis.self.onmessage({ data: { ...request, config: { ...request.config, maxTime: 50, maxDepth: 3 } } })
  const response = responses.at(-1)
  assert.equal(response.id, request.id)
  assert.equal(response.result.move.length, 2)
  worker.emit(response)
}
const savedGame = state => ({ board: state.root, activeConstraint: state.constraint, currentPlayer: state.player === 1 ? 'X' : 'O', winner: null, depth: 2 })
const autoplay = mountGame({ ...savedGame(newState(engine, 2)), gameMode: 'AIvAI' })
autoplay.flush()
assert.equal(autoplay.created.length, 1, 'both AI players should acquire one engine')
const shared = autoplay.created[0]
assert(shared.messages.length > 0, 'restored AI game must post its first search after worker initialization')
const xRequest = shared.messages.at(-1).message
assert.equal(xRequest.type, 'search', 'restored AI game must start after worker initialization')
assert.equal(xRequest.player, 'X')
processGameRequest(shared, xRequest)
autoplay.flushTimers()
assert.equal(autoplay.game.currentPlayer, 'O')
assert.equal(autoplay.created.length, 1, 'opponent turn should reuse the same engine')
const oRequest = shared.messages.at(-1).message
assert.equal(oRequest.player, 'O')
assert(oRequest.id > xRequest.id)
processGameRequest(shared, oRequest)
autoplay.flushTimers()
assert.equal(autoplay.game.currentPlayer, 'X')
const abandoned = shared.messages.at(-1).message
autoplay.game.resetGame('PvAI', 2)
autoplay.flush()
assert.equal(shared.terminated, true, 'reset must cancel the shared pending search')
const resetWorker = autoplay.created.at(-1)
assert.notEqual(resetWorker, shared)
resetWorker.emit({ type: 'result', id: abandoned.id, result: { move: [4, 4] } })
assert.equal(autoplay.timers.length, 0, 'reset must reject stale request IDs before scheduling a move')
assert.equal(autoplay.game.currentPlayer, 'X')
assert(engine.logic.isEmpty(autoplay.game.board))
autoplay.unmount()
assert.equal(resetWorker.terminated, false, 'idle shared worker should remain reusable after unmount')

const restoredOpponent = mountGame({ ...savedGame(firstState), gameMode: 'PvAI' })
restoredOpponent.flush()
assert.equal(restoredOpponent.created.length, 1)
assert(restoredOpponent.created[0].messages.length > 0, 'restored PvAI opponent turn must post its first search')
assert.equal(restoredOpponent.created[0].messages.at(-1).message.player, 'O', 'restored opponent turn must start after worker initialization')
restoredOpponent.unmount()
assert.equal(restoredOpponent.created[0].terminated, true, 'unmount must cancel the shared active search')

console.log(JSON.stringify({ passed: true, workerCases: 13, coldNodes: cold.nodes, warmNodes: warm.nodes, poolCases: 9, gameLifecycleCases: 5 }))
