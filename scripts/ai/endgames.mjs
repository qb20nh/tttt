import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEngine, random, newState, legalMoves, treeLegalMoves, advance, searchPosition, argument, report } from './harness.mjs'

const engine = loadEngine(resolve(argument('engine', '.')))
const boards = argument('boards', '3').split(',').map(Number)
const casesPerBoard = Number(argument('cases', boards.includes(4) ? '1' : '2'))
const seed = Number(argument('seed', '20261013'))
const maxCells = Number(argument('max-cells', '8'))
const nodeLimit = Number(argument('oracle-nodes', '100000'))
const budget = Number(argument('budget', '10000'))
assert(boards.every(depth => Number.isInteger(depth) && depth >= 2 && depth <= 4), 'boards must contain depths 2, 3 or 4')
assert(Number.isInteger(casesPerBoard) && casesPerBoard > 0, 'cases must be a positive integer')
assert(Number.isInteger(maxCells) && maxCells > 0 && maxCells <= 16, 'max-cells must be between 1 and 16')
assert(Number.isInteger(nodeLimit) && nodeLimit > 0, 'oracle-nodes must be a positive integer')

const cases = []
const file = argument('cases-file', '')
if (file) {
  const saved = JSON.parse(readFileSync(resolve(file), 'utf8'))
  for (const depth of boards) {
    const selected = saved.filter(entry => entry.depth === depth).slice(0, casesPerBoard)
    assert.equal(selected.length, casesPerBoard, `case file needs ${casesPerBoard} D${depth} trajectories`)
    for (const entry of selected) {
      assert(Array.isArray(entry.moves) && entry.moves.length <= 9 ** depth, 'saved trajectory is invalid')
      let state = newState(engine, depth)
      for (const move of entry.moves) state = advance(engine, state, move, { copy: false })
      assert(!state.root.winner, 'saved endgame must be nonterminal')
      cases.push({ ...entry, state, globalCount: treeLegalMoves({ ...state, constraint: [] }).length })
    }
  }
} else {
  for (const depth of boards) {
    const maxGames = Number(argument('games', depth === 4 ? '1' : '10'))
    assert(Number.isInteger(maxGames) && maxGames > 0, 'games must be a positive integer')
    let found = 0
    for (let game = 0; game < maxGames && found < casesPerBoard; game++) {
      const gameSeed = seed + depth * 900001 + game * 65537
      const rng = random(gameSeed)
      let state = newState(engine, depth)
      let lastGlobalCount = 9 ** depth
      assert.deepEqual(treeLegalMoves(state), legalMoves(engine, state), 'tree traversal must match public path validity')
      while (!state.root.winner) {
        const globalCount = treeLegalMoves({ ...state, constraint: [] }).length
        lastGlobalCount = globalCount
        if (globalCount > 0 && globalCount <= maxCells) {
          assert.deepEqual(treeLegalMoves(state), legalMoves(engine, state), 'endgame traversal must match public path validity')
          cases.push({ depth, seed: gameSeed, game, state, globalCount })
          found++
          break
        }
        const legal = treeLegalMoves(state)
        assert(legal.length, 'nonterminal trajectory must have a legal move')
        // No cloning is needed while generating one trajectory: only the final
        // selected state is retained. Every move is checked by public UI rules.
        state = advance(engine, state, legal[Math.floor(rng() * legal.length)], { copy: false })
      }
      console.error(`D${depth} game ${game + 1}/${maxGames}: ${state.moves.length} plies, ${lastGlobalCount} last playable cells, terminal ${state.root.winner || 'no'}, ${found}/${casesPerBoard} endgames`)
    }
    assert.equal(found, casesPerBoard, `only ${found}/${casesPerBoard} D${depth} endgames found in ${maxGames} legal games; increase --games or choose another --seed`)
  }
}
for (const entry of cases) assert(entry.globalCount > 0 && entry.globalCount <= maxCells, 'selected endgame exceeds the exact-solving cell limit')

const save = argument('save-cases', '')
if (save) writeFileSync(resolve(save), `${JSON.stringify(cases.map(({ depth, seed, game, state }) => ({ depth, seed, game, moves: state.moves })), null, 2)}\n`)

// Closed descendant histories cannot affect future legality or winners. Encode
// their authoritative status once; this keeps D4 memo keys compact without
// borrowing any packed AI state or transposition hashing.
function encode (node) {
  if (node.winner) return node.winner === 'Draw' ? 'D' : node.winner
  if (!node.children) return node.value || '-'
  if (engine.logic.isFull(node)) return '#'
  return `(${node.children.map(encode).join('')})`
}

const results = []
for (const entry of cases) {
  const memo = new Map()
  let oracleNodes = 0
  function exact (state) {
    if (state.root.winner) return { outcome: state.root.winner === 'Draw' ? 0 : state.root.winner === (state.player === 1 ? 'X' : 'O') ? 1 : -1, distance: 0 }
    const key = `${state.player}:${state.constraint.join(',')}:${encode(state.root)}`
    if (memo.has(key)) return memo.get(key)
    assert(++oracleNodes <= nodeLimit, `exact D${entry.depth} oracle exceeded --oracle-nodes ${nodeLimit}; no partial result is accepted`)
    let best = { outcome: -2, distance: 0 }
    for (const move of treeLegalMoves(state)) {
      const child = exact(advance(engine, state, move))
      const candidate = { outcome: -child.outcome, distance: child.outcome === 0 ? 0 : child.distance + 1 }
      if (candidate.outcome > best.outcome || (candidate.outcome === best.outcome &&
        (candidate.outcome === 1 ? candidate.distance < best.distance : candidate.outcome === -1 && candidate.distance > best.distance))) best = candidate
    }
    assert(best.outcome >= -1, 'exact oracle encountered a nonterminal state without legal moves')
    memo.set(key, best)
    return best
  }
  const expected = exact(entry.state)
  const expectedScore = expected.outcome === 0 ? 0 : expected.outcome * (100000 - expected.distance)
  const check = (result) => {
    const chosen = exact(advance(engine, entry.state, result.move))
    assert(-chosen.outcome === expected.outcome, `D${entry.depth} selected move must preserve exact outcome`)
    if (expected.outcome !== 0) assert.equal(chosen.distance + 1, expected.distance, `D${entry.depth} selected move must preserve optimal mate distance`)
    assert(result.score === expectedScore, `D${entry.depth} score must match root-relative exact outcome and mate distance`)
    assert(result.depth >= entry.globalCount || Math.abs(result.score) >= 90000, 'search must finish or prove a terminal outcome')
  }
  const cold = searchPosition(engine, entry.state, entry.globalCount, budget)
  check(cold)
  const cached = searchPosition(engine, entry.state, entry.globalCount, budget, { clear: false })
  check(cached)
  assert.equal(cached.nodes, 1, 'fully cached exact endgame must require one root probe')
  const child = advance(engine, entry.state, cold.move)
  searchPosition(engine, child, entry.globalCount, budget, { clear: false })
  const warm = searchPosition(engine, entry.state, entry.globalCount, budget, { clear: false })
  check(warm)
  results.push({ boardDepth: entry.depth, seed: entry.seed, game: entry.game, ply: entry.state.moves.length, globallyPlayableCells: entry.globalCount, expected, oracleNodes, cold, cached, warm })
}
report({ passed: true, boards, casesPerBoard, maxCells, nodeLimit, results })
