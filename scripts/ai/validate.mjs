import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadEngine, random, newState, legalMoves, treeLegalMoves, advance, boardOf, generatedMoves, snapshot, searchPosition, argument, report, patterns, pathOf, moveOf } from './harness.mjs'
import { validateOpeningOrbits } from './opening-orbits.mjs'
import { validateRootWinTactics } from './tactics.mjs'
import { validateColorSymmetry } from './colors.mjs'
import { validateLookupTables } from './lookup-tables.mjs'
import { validateOrderRanks } from './order-ranks.mjs'
import { validateLeafWins } from './leaf-wins.mjs'

const started = performance.now()
const engine = loadEngine(resolve(argument('engine', '.')))
const lookupTables = validateLookupTables(engine)
const orderRanks = validateOrderRanks(engine)
const leafWins = validateLeafWins(engine)
const routingSearch = new engine.Search()
const counts = { rulesPositions: 0, mutations: 0, routingChecks: 0, constraintReleases: 0, localDraws: 0, exactPositions: 0, exactSearches: 0, narrowWindowSearches: 0, exactD2Endgames: 0, exactD2OracleNodes: 0, closedCellDepthCaps: 0, globalCountPositions: 0, globalCountLimits: 0, globalCountTerminals: 0, ownershipCacheTransitions: 0 }

function checkGlobalCount (state, board = boardOf(engine, state)) {
  const expected = treeLegalMoves({ ...state, constraint: [] }).length
  const before = snapshot(board)
  for (const limit of [0, 1, 9, 64, 255, expected + 1]) {
    assert.equal(engine.MoveGen.countGlobal(board, limit), Math.min(limit, expected), `capped global count differs from tree oracle at D${state.depth}, limit ${limit}, history ${state.moves}`)
    counts.globalCountLimits++
  }
  assert.deepEqual(snapshot(board), before, 'global count must preserve constraints, hierarchy, hashes, and evaluation')
  counts.globalCountPositions++
  if (state.root.winner) counts.globalCountTerminals++
}

// Include sparse persisted closures at every supported hierarchy depth. Their
// empty descendants remain unavailable even when the current target is ignored.
for (const depth of [1, 2, 3, 4]) {
  const state = newState(engine, depth)
  checkGlobalCount(state)
  if (depth > 1) {
    checkGlobalCount({ ...state, constraint: Array(depth - 1).fill(8) })
    const closed = structuredClone(state)
    closed.root.children[0].winner = 'Draw'
    closed.root.children[1].winner = 'X'
    closed.root.children[2].winner = 'O'
    if (depth > 2) closed.root.children[4].children[0].winner = 'Draw'
    checkGlobalCount(closed)
    checkGlobalCount({ ...closed, constraint: Array(depth - 1).fill(8) })
  }
  for (const winner of ['X', 'O', 'Draw']) {
    const terminal = structuredClone(state)
    terminal.root.winner = winner
    checkGlobalCount(terminal)
  }
}

// Capturing a parent changes its ownership even when the child's possibility
// mask was already limited to that player. An unchanged possibility key alone
// is insufficient to skip updating the parent's cached possibility status.
for (const player of [1, 2]) {
  const board = new engine.Board(3)
  for (const move of [0, 1, 2, 9, 10, 11, 18, 20, 22, 25]) board.setCell(move, player)
  for (const move of [21, 23]) board.setCell(move, 3 - player)
  const caches = target => ({
    possibleKeys: target.possibleKeys.map(layer => [...layer]),
    possibleWins: target.possibleWins.map(layer => [...layer]),
    childScores: target.childScores.map(layer => [...layer]),
    subtreeScores: target.subtreeScores.map(layer => [...layer]),
  })
  const before = snapshot(board)
  const beforeCaches = caches(board)
  const possibleKey = board.possibleKeys[1][0]
  assert.equal(board.possibleWins[1][0], 3, 'open macro must initially permit both players')
  assert.equal(board.possibleWins[2][2], player, 'target local already permits only the capturing player')
  assert.equal(board.setCell(19, player), 1, 'move must capture the local and macro boards')
  assert.equal(board.possibleKeys[1][0], possibleKey, 'fixture must retain the parent possibility key across capture')
  assert.equal(board.possibleWins[1][0], player, 'captured macro must update its possibility ownership')
  const rebuilt = board.clone()
  rebuilt.rebuildEvaluation()
  assert.deepEqual(caches(board), caches(rebuilt), 'capture caches must match complete bottom-up rebuild')
  assert.deepEqual(snapshot(board), snapshot(rebuilt), 'capture evaluation and terminal state must match rebuild')
  board.setCell(19, 0)
  assert.deepEqual(caches(board), beforeCaches, 'capture undo must restore every incremental cache')
  assert.deepEqual(snapshot(board), before, 'capture undo must restore board identity and evaluation')
  counts.ownershipCacheTransitions++
}

{
  const state = advance(engine, newState(engine, 2), 0)
  const cold = searchPosition(engine, state, 5, 10000)
  const warm = searchPosition(engine, state, 5, 10000, { clear: false })
  assert(warm.score === cold.score, 'fully cached fixed-depth root must preserve its score')
  assert.equal(warm.move, cold.move, 'fully cached fixed-depth root must preserve its move')
  assert.equal(warm.nodes, 1, 'fully cached fixed-depth root should require one probe')
  assert.equal(warm.depth, cold.depth, 'fully cached root must report its proven depth')
}

// Diagnostics must be reusable after a real deadline abort. Inject the same
// stale flag if this machine happens to stop exactly between iterations.
{
  const state = newState(engine, 2)
  const board = boardOf(engine, state)
  const before = snapshot(board)
  const reused = new engine.Search()
  engine.tt.clear()
  reused.search(board, 1, 64, 2)
  assert.deepEqual(snapshot(board), before, 'timed diagnostic setup must restore its board')
  if (!reused.abort) reused.abort = true
  const fresh = new engine.Search().alphaBeta(board, 1, 3, -Infinity, Infinity, 0, false)
  const analyzed = reused.alphaBeta(board, 1, 3, -Infinity, Infinity, 0, false)
  assert(analyzed.score === fresh.score, 'analysis after timeout must match fresh analysis on warmed data')
  assert(legalMoves(engine, state).includes(analyzed.move), 'analysis after timeout must return a legal move')
  assert.equal(reused.abort, false, 'diagnostic entry must clear an earlier abort')
  assert.deepEqual(snapshot(board), before, 'reused diagnostic analysis must restore its board')
  const terminal = structuredClone(state)
  terminal.root.winner = 'Draw'
  assert.deepEqual(reused.alphaBeta(boardOf(engine, terminal), 1, 3, -Infinity, Infinity, 0, false), { score: 0, move: -1 }, 'terminal analysis must reset prior move state')
  assert.equal(reused.nodesVisited, 1, 'diagnostic node counts must restart for each call')
}

// A deeper cached child can prove a five-ply win during a shallow iteration.
// The root must keep deepening until it can establish the faster three-ply fork.
{
  let state = newState(engine, 1)
  for (const move of [1, 6, 8, 7]) state = advance(engine, state, move)
  const cold = searchPosition(engine, state, 5, 10000)
  assert.equal(cold.score, 99997, 'cold D1 fork must prove the shortest three-ply win')
  searchPosition(engine, advance(engine, state, 5), 4, 10000)
  const warmed = searchPosition(engine, state, 5, 10000, { clear: false })
  assert.equal(warmed.score, 99997, 'deeper cached five-ply win must not stop discovery of a three-ply win')
  assert([0, 2].includes(warmed.move), 'warm D1 fork must choose a fastest forced win')
}

// Occupancy is separate from the valid zero hash. Collision checks cover both
// 32-bit halves; aging permits shallow new searches to replace stale deep data.
{
  const table = new engine.TT(4)
  assert.equal(table.get(0n), undefined, 'empty table must not fabricate zero-hash entry')
  table.put(0n, 7, 123, 'exact', -1)
  assert.deepEqual(table.get(0n), { depth: 7, score: 123, flag: 'exact', bestMove: -1 })
  table.put(0n, 7, 99, 'lower', 4)
  assert.equal(table.get(0n).score, 123, 'same-depth bound must not overwrite exact entry')
  table.newSearch()
  assert.equal(table.get(0n).score, 123, 'aging retains reusable identities')
  const collision = 0xdeadbeeff0000004n
  table.put(collision, 2, -987, 'upper', 6560)
  assert.equal(table.get(0n), undefined, 'collision must reject previous identity')
  assert.deepEqual(table.get(collision), { depth: 2, score: -987, flag: 'upper', bestMove: 6560 })
  assert.equal(table.getIndexParts(0xf0000004 | 0, 0xdeadbeef | 0), table.getIndex(collision), 'signed key halves must preserve full 64-bit identity')
  table.clear()
  assert.equal(table.get(collision), undefined, 'clear invalidates occupied slots')
  table.put(0n, 1, 12, 'exact', 0)
  for (let search = 0; search < 255; search++) table.newSearch()
  assert.equal(table.get(0n), undefined, 'generation rollover invalidates stale occupancy')
}

// Persisted trees may close nodes before every descendant is filled. The
// adapter must preserve those explicit closures and include them in TT identity.
{
  const state = newState(engine, 2)
  const empty = boardOf(engine, state)
  const terminal = structuredClone(state)
  terminal.root.winner = 'Draw'
  const drawn = boardOf(engine, terminal)
  assert.equal(drawn.getWinner(), 3, 'explicit root Draw must survive adaptation')
  assert.deepEqual(generatedMoves(engine, drawn), [], 'explicit root Draw must have no legal moves')
  assert.notEqual(drawn.hash, empty.hash, 'explicit root closure must distinguish TT identity')
  checkGlobalCount(terminal, drawn)
  for (const winner of ['X', 'Draw']) {
    const closed = structuredClone(state)
    closed.root.children[0].winner = winner
    const board = boardOf(engine, closed)
    assert.deepEqual(generatedMoves(engine, board), Array.from({ length: 72 }, (_, index) => index + 9), 'explicit intermediate closure must exclude descendants')
    assert.notEqual(board.hash, empty.hash, 'explicit intermediate closure must distinguish TT identity')
    checkGlobalCount(closed, board)
  }
  const propagated = structuredClone(state)
  for (const index of [0, 1, 2]) propagated.root.children[index].winner = 'X'
  assert.equal(boardOf(engine, propagated).getWinner(), 1, 'explicit child wins must propagate to parent')
}

// Completing a local board as a Draw must retain ordinary relative targeting;
// getWonDepth changes routing only for an actual X/O win.
{
  const state = newState(engine, 3)
  const local = state.root.children[0].children[0]
  for (const [index, value] of [1, 2, 1, 1, 2, 2, 2, 1].entries()) local.children[index].value = value === 1 ? 'X' : 'O'
  state.constraint = [0, 0]
  const board = boardOf(engine, state)
  assert(generatedMoves(engine, board).includes(8), 'non-full local stalemate remains playable under UI rules')
  const next = advance(engine, state, 8)
  assert.deepEqual(next.constraint, [0, 8], 'local Draw uses ordinary targeting')
  assert.equal(board.setCell(8, 1), -1, 'local Draw must not report a won-depth routing override')
}

// Oracle winner logic is exhaustive and does not use lookup tables or the search.
function simpleWinner (cells) {
  for (const [a, b, c] of patterns) if ((cells[a] === 1 || cells[a] === 2) && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a]
  const possible = [1, 2].some(player => patterns.some(line => line.every(index => cells[index] === 0 || cells[index] === player)))
  return !possible || cells.every(Boolean) ? 3 : 0
}

// Warm transposition-table regression: equal numeric constraints at distinct
// hierarchy layers have different legal moves despite identical leaf contents.
{
  const board = new engine.Board(3)
  board.setCell(0, 1)
  board.constraint = 1
  board.constraintLayer = 1
  engine.tt.clear()
  new engine.Search().search(board, 2, 1, 1000)
  board.constraintLayer = 2
  const result = new engine.Search().search(board, 2, 1, 1000)
  assert(result.move >= 9 && result.move <= 17, 'warm TT must distinguish constraint layers')
}
engine.tt.clear()
for (const depth of [2, 3, 4]) {
  const board = new engine.Board(depth)
  board.setCell(0, 1)
  board.constraint = 1
  board.constraintLayer = 1
  const result = new engine.Search().search(board, 2, 1, 1000)
  const start = 9 ** (depth - 1)
  assert(result.move >= start && result.move < start * 2, 'warm TT must distinguish board depths')
}
{
  const board = new engine.Board(2)
  for (const move of [0, 1, 2]) board.setCell(move, 1)
  board.constraint = 0
  board.constraintLayer = 1
  board.normalizeConstraint()
  assert.equal(board.constraint, -1, 'root-wide release must use canonical free constraint')
  assert.equal(board.constraintLayer, -1, 'root-wide release must use canonical free layer')
  const freeScore = board.evaluate(1)
  board.constraint = 0
  board.constraintLayer = 0
  board.normalizeConstraint()
  assert.equal(board.constraint, -1, 'explicit root constraint must canonicalize to free')
  assert.equal(board.constraintLayer, -1, 'explicit root layer must canonicalize to free')
  assert.equal(board.evaluate(1), freeScore, 'canonical root release must retain free-move evaluation')
}

// A closed local target releases only to its playable parent. An open local
// target inside a won ancestor must also release outside that ancestor.
{
  const board = new engine.Board(3)
  for (const move of [0, 1, 2]) board.setCell(move, 1)
  board.constraint = 0
  board.constraintLayer = 2
  assert.deepEqual(generatedMoves(engine, board), Array.from({ length: 72 }, (_, index) => index + 9), 'closed local target must release to macro parent')
  for (const move of [9, 10, 11, 18, 19, 20]) board.setCell(move, 1)
  board.constraint = 3
  board.constraintLayer = 2
  assert.deepEqual(generatedMoves(engine, board), Array.from({ length: 648 }, (_, index) => index + 81), 'won ancestor must release to root')
}

// A deeper cached child score must not make a slower win beat an immediate win.
{
  const board = new engine.Board(1)
  for (const move of [0, 1]) board.setCell(move, 1)
  for (const move of [3, 7]) board.setCell(move, 2)
  board.constraint = -1
  board.constraintLayer = -1
  engine.tt.clear()
  assert.equal(new engine.Search().search(board, 1, 1, 1000).move, 2, 'cold search should take the immediate win')
  board.setCell(4, 1)
  board.constraint = -1
  board.constraintLayer = -1
  const search = new engine.Search()
  search.startTime = performance.now()
  search.timeLimit = 10000
  search.alphaBeta(board, 2, 8, -Infinity, Infinity, 0, false)
  board.setCell(4, 0)
  board.constraint = -1
  board.constraintLayer = -1
  assert.equal(new engine.Search().search(board, 1, 1, 1000).move, 2, 'warm search should retain the immediate win')
}

// Drawn sectors block winning lines and material gains must survive scaling.
{
  const blocked = 1 | (1 << 2) | (3 << 4)
  const open = 1 | (1 << 2)
  assert(engine.lookup.LUT_SCORE_BASE4[blocked] < engine.lookup.LUT_SCORE_BASE4[open], 'drawn sector must block a two-in-row threat')
  const board = new engine.Board(2)
  for (const move of [0, 1, 2]) board.setCell(move, 1)
  const singleWin = board.evaluate(1)
  for (const move of [9, 10, 11]) board.setCell(move, 1)
  assert(board.evaluate(1) > singleWin, 'evaluation should distinguish one local win from two')
}

const values = new Map()
function exactD1 (cells, player) {
  const key = `${cells.join('')}:${player}`
  if (values.has(key)) return values.get(key)
  const winner = simpleWinner(cells)
  if (winner) return { outcome: winner === 3 ? 0 : winner === player ? 1 : -1, distance: 0 }
  let best = { outcome: -2, distance: 0 }
  for (let move = 0; move < 9; move++) {
    if (cells[move]) continue
    cells[move] = player
    const child = exactD1(cells, 3 - player)
    const candidate = { outcome: -child.outcome, distance: child.outcome === 0 ? 0 : child.distance + 1 }
    if (candidate.outcome > best.outcome || (candidate.outcome === best.outcome &&
      (candidate.outcome === 1 ? candidate.distance < best.distance : candidate.outcome === -1 && candidate.distance > best.distance))) best = candidate
    cells[move] = 0
  }
  values.set(key, best)
  return best
}

function checkRules (state) {
  const board = boardOf(engine, state)
  const expected = state.root.winner === 'X' ? 1 : state.root.winner === 'O' ? 2 : state.root.winner === 'Draw' ? 3 : 0
  assert.equal(board.getWinner(), expected, `packed winner differs from UI at D${state.depth}, history ${state.moves}`)
  const legal = legalMoves(engine, state)
  assert.deepEqual(treeLegalMoves(state), legal, 'fast tree oracle must match public path validity')
  assert.deepEqual(generatedMoves(engine, board), legal, `packed legality differs from UI at D${state.depth}, history ${state.moves}`)
  assert.deepEqual(snapshot(board.clone()), snapshot(board), 'clone must preserve evaluation and state')
  const rebuilt = board.clone()
  rebuilt.rebuildEvaluation()
  assert.deepEqual(snapshot(rebuilt), snapshot(board), 'incremental evaluation/terminal caches must match full rebuild')
  counts.rulesPositions++
  if (counts.rulesPositions % 211 === 0 || state.moves.length === 0 || state.root.winner) checkGlobalCount(state, board)
  if (!legal.length) return
  const move = legal[(state.moves.length * 17) % legal.length]
  const before = snapshot(board)
  board.setCell(move, state.player)
  assert.deepEqual(snapshot(board.clone()), snapshot(board), 'mutated clone must preserve evaluation')
  const rebuiltMutation = board.clone()
  rebuiltMutation.rebuildEvaluation()
  assert.deepEqual(snapshot(rebuiltMutation), snapshot(board), 'mutated evaluation/terminal caches must match full rebuild')
  board.setCell(move, 0)
  assert.deepEqual(snapshot(board), before, `setCell undo differs at D${state.depth}, history ${state.moves}`)
  // Exercise the actual central make-move path used by both main search and
  // tactical extensions. Tree-rule advance supplies the expected routing.
  const expectedState = advance(engine, state, move)
  const expectedBoard = boardOf(engine, expectedState)
  routingSearch.playMove(board, move, state.player)
  assert.deepEqual([...board.leaves], [...expectedBoard.leaves], 'search move must preserve tree-rule leaf state')
  assert.deepEqual(board.keys.map(layer => [...layer]), expectedBoard.keys.map(layer => [...layer]), 'search move must preserve tree-rule hierarchy')
  assert.equal(board.getWinner(), expectedBoard.getWinner(), 'search move must preserve tree-rule terminal status')
  assert.deepEqual(generatedMoves(engine, board), legalMoves(engine, expectedState), 'search move must preserve tree-rule legal replies')
  if (!expectedState.root.winner) {
    assert.equal(board.constraint, expectedBoard.constraint, `search routing index differs from tree rules at D${state.depth}, history ${state.moves}, move ${move}`)
    assert.equal(board.constraintLayer, expectedBoard.constraintLayer, `search routing layer differs from tree rules at D${state.depth}, history ${state.moves}, move ${move}`)
    assert.equal(board.evaluate(expectedState.player), expectedBoard.evaluate(expectedState.player), 'search move incremental evaluation must match tree import')
  }
  counts.routingChecks++
  board.setCell(move, 0)
  board.constraint = before.constraint
  board.constraintLayer = before.constraintLayer
  assert.deepEqual(snapshot(board), before, 'central make-move path must allow exact undo')
  if (counts.rulesPositions % 211 === 0) {
    for (let symmetry = 0; symmetry < 8; symmetry++) {
      const transformed = { ...state, root: engine.symmetry.transformBoard(state.root, symmetry), constraint: engine.symmetry.transformConstraint(state.constraint, symmetry) }
      const transformedBoard = boardOf(engine, transformed)
      const transformedLegal = legal.map(move => moveOf(engine.symmetry.transformPath(pathOf(move, state.depth), symmetry))).sort((a, b) => a - b)
      assert.deepEqual(generatedMoves(engine, transformedBoard), transformedLegal, 'symmetry must preserve legal moves')
      assert.equal(transformedBoard.getWinner(), board.getWinner(), 'symmetry must preserve terminal status')
      assert.equal(transformedBoard.evaluate(state.player), board.evaluate(state.player), 'symmetry must preserve evaluation')
    }
  }
  counts.mutations++
}

// Include full local draws and ancestor constraint releases on actual legal games.
for (const [depth, games, maxPlies] of [[1, 24, 9], [2, 32, 81], [3, 10, 729], [4, 3, 400]]) {
  for (let game = 0; game < games; game++) {
    const rng = random(20261013 + depth * 1237 + game * 65537)
    let state = newState(engine, depth)
    for (let ply = 0; ply <= maxPlies; ply++) {
      checkRules(state)
      const legal = legalMoves(engine, state)
      if (!legal.length || ply === maxPlies) break
      state = advance(engine, state, legal[Math.floor(rng() * legal.length)])
    }
    counts.constraintReleases += state.releases
    counts.localDraws += state.draws
  }
}
assert(counts.constraintReleases > 0, 'seeded suite must exercise constraint releases')
assert(counts.localDraws > 0, 'seeded suite must exercise local full draws without a win')

// Enumerate every reachable D1 position, including terminal positions, then verify
// exact outcome and mate distance: fastest forced wins and slowest forced losses.
// Warm-table runs cross ply and search-depth changes.
const seen = new Set()
const states = []
function enumerate (state) {
  const cells = state.root.children.map(child => child.value === 'X' ? 1 : child.value === 'O' ? 2 : 0)
  const key = `${cells.join('')}:${state.player}`
  if (seen.has(key)) return
  seen.add(key)
  states.push(state)
  for (const move of legalMoves(engine, state)) enumerate(advance(engine, state, move))
}
enumerate(newState(engine, 1))
engine.tt.clear()
for (let index = 0; index < states.length; index++) {
  const state = states[index]
  checkRules(state)
  const cells = state.root.children.map(child => child.value === 'X' ? 1 : child.value === 'O' ? 2 : 0)
  const expected = exactD1(cells, state.player)
  const result = searchPosition(engine, state, 9 - state.moves.length, 10000, { clear: index % 61 === 0 })
  if (!state.root.winner) {
    cells[result.move] = state.player
    const chosen = exactD1(cells, 3 - state.player)
    assert(-chosen.outcome === expected.outcome, `D1 suboptimal outcome at history ${state.moves}`)
    if (expected.outcome !== 0) assert.equal(chosen.distance + 1, expected.distance, `D1 suboptimal mate distance at history ${state.moves}`)
  }
  const expectedScore = expected.outcome === 0 ? 0 : expected.outcome * (100000 - expected.distance)
  assert(result.score === expectedScore, `D1 root-relative mate score differs from exact minimax at history ${state.moves}: ${result.score} vs ${expectedScore}`)
  if (index % 97 === 0) {
    for (const [alpha, beta] of [[expectedScore - 1, expectedScore + 1], [expectedScore + 3, expectedScore + 4], [expectedScore - 4, expectedScore - 3]]) {
      engine.tt.clear()
      const board = boardOf(engine, state)
      const before = snapshot(board)
      const bound = new engine.Search().alphaBeta(board, state.player, 9 - state.moves.length, alpha, beta, 0, false).score
      if (expectedScore <= alpha) assert(bound >= expectedScore && bound <= alpha, 'fail-low result must be a sound upper bound')
      else if (expectedScore >= beta) assert(bound <= expectedScore && bound >= beta, 'fail-high result must be a sound lower bound')
      else assert(bound === expectedScore, 'in-window search must return exact mate score')
      assert.deepEqual(snapshot(board), before, 'narrow-window analysis must restore the board')
      counts.narrowWindowSearches++
    }
  }
  counts.exactPositions++
  counts.exactSearches++
}

// Solve independently from public tree rules, without packed keys, AI move
// generation, search evaluation, or transposition-table identities.
const endgameValues = new Map()
const encodeTree = (node) => `${node.winner || '-'}${node.value || '-'}${node.children ? node.children.map(encodeTree).join('') : ''}`
function exactEndgameValue (state) {
  if (state.root.winner) return state.root.winner === 'Draw' ? 0 : state.root.winner === (state.player === 1 ? 'X' : 'O') ? 1 : -1
  const key = `${state.player}:${state.constraint.join(',')}:${encodeTree(state.root)}`
  if (endgameValues.has(key)) return endgameValues.get(key)
  counts.exactD2OracleNodes++
  let best = -1
  for (const move of legalMoves(engine, state)) {
    best = Math.max(best, -exactEndgameValue(advance(engine, state, move)))
    if (best === 1) break
  }
  endgameValues.set(key, best)
  return best
}
const endgames = []
for (let game = 0; game < 4096 && endgames.length < 24; game++) {
  const rng = random(20261013 + 900001 + game * 65537)
  let state = newState(engine, 2)
  while (!state.root.winner) {
    const globalCount = legalMoves(engine, { ...state, constraint: [] }).length
    if (globalCount > 0 && globalCount <= 8) {
      endgames.push({ state, globalCount })
      break
    }
    const legal = legalMoves(engine, state)
    if (!legal.length) break
    state = advance(engine, state, legal[Math.floor(rng() * legal.length)])
  }
}
assert.equal(endgames.length, 24, 'seeded reachable games must supply the D2 exact endgame suite')
const endgameOutcomes = { win: 0, draw: 0, loss: 0 }
for (const { state, globalCount } of endgames) {
  const expected = exactEndgameValue(state)
  endgameOutcomes[expected === 1 ? 'win' : expected === -1 ? 'loss' : 'draw']++
  const result = searchPosition(engine, state, globalCount, 10000)
  assert(-exactEndgameValue(advance(engine, state, result.move)) === expected, `D2 exact endgame chose a suboptimal move at history ${state.moves}`)
  const actual = result.score >= 90000 ? 1 : result.score <= -90000 ? -1 : result.score === 0 ? 0 : null
  assert(actual === expected, `D2 solved score sign differs from exact outcome at history ${state.moves}`)
  assert(result.depth >= globalCount || Math.abs(result.score) >= 90000, 'D2 endgame must finish search or prove a terminal outcome')
  const cached = searchPosition(engine, state, globalCount, 10000, { clear: false })
  assert.equal(cached.nodes, 1, 'fully cached mixed-leaf endgame should require one root probe')
  assert(cached.score === result.score, 'fully cached endgame must preserve its proven outcome and distance')
  assert.equal(cached.depth, result.depth, 'fully cached endgame must report its proven depth')
  const child = advance(engine, state, result.move)
  searchPosition(engine, child, globalCount, 10000, { clear: false })
  const warmed = searchPosition(engine, state, globalCount, 10000, { clear: false })
  assert(-exactEndgameValue(advance(engine, state, warmed.move)) === expected, 'warm D2 endgame must preserve exact outcome')
  counts.exactD2Endgames++
  const rawEmpty = boardOf(engine, state).leaves.reduce((count, value) => count + Number(value === 0), 0)
  if (expected === 0 && rawEmpty > globalCount) {
    const capped = searchPosition(engine, state, 64, 10000, { clear: false })
    assert.equal(capped.score, 0, 'closed-cell depth cap must retain exact Draw outcome')
    assert.equal(capped.depth, globalCount, 'unused leaves in closed sectors must not extend solved Draw iterations')
    assert(-exactEndgameValue(advance(engine, state, capped.move)) === 0, 'closed-cell depth cap must retain a drawing move')
    counts.closedCellDepthCaps++
  }
}
assert(counts.closedCellDepthCaps > 0, 'exact endgame suite must exercise unused closed-sector leaves')

// Root identity must include depth and the constraint layer: same leaf contents,
// same numeric constraint, different legal ranges. Reuse TT deliberately.
for (const depth of [2, 3, 4]) {
  const root = newState(engine, depth)
  const states = [root, { ...root, constraint: [0] }, { ...root, constraint: Array(depth - 1).fill(0) }]
  engine.tt.clear()
  for (const state of states) searchPosition(engine, state, 2, 200, { clear: false })
}

const deadlines = []
for (const depth of [2, 3, 4]) {
  const state = advance(engine, newState(engine, depth), 0)
  for (const budget of [0, 2, 10]) {
    const result = searchPosition(engine, state, 30, budget)
    // Allow scheduling overhead, but reject tens/hundreds of ms on tiny budgets.
    assert(result.elapsed <= budget + 35, `D${depth} ${budget}ms deadline overrun: ${result.elapsed.toFixed(1)}ms`)
    deadlines.push({ boardDepth: depth, budget, elapsed: Number(result.elapsed.toFixed(2)), depth: result.depth, nodes: result.nodes })
  }
}
const openingOrbits = validateOpeningOrbits(engine)
const rootWinTactics = validateRootWinTactics(engine)
const colorSymmetry = validateColorSymmetry(engine)
assert(counts.globalCountPositions > 0 && counts.globalCountTerminals > 0, 'global count suite must include sampled positions and terminals')
report({ passed: true, elapsed: performance.now() - started, counts, lookupTables, orderRanks, leafWins, endgameOutcomes, openingOrbits, rootWinTactics, colorSymmetry, deadlines })
