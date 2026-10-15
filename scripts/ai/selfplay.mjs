import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadEngine, random, newState, legalMoves, treeLegalMoves, advance, searchPosition, argument, report } from './harness.mjs'

const baselinePath = argument('baseline', '/tmp/tttt-ai-baseline')
const engines = [loadEngine(resolve(baselinePath)), loadEngine(resolve(argument('engine', '.')))]
const rules = engines[1]
const pairs = Number(argument('pairs', '20'))
const budget = Number(argument('budget', '20'))
const boardDepth = Number(argument('board', '2'))
const searchDepthLimit = Number(argument('depth', '30'))
const openingPlies = Number(argument('opening', '4'))
const seed = Number(argument('seed', '20261013'))
const fastLegal = process.argv.includes('--fast-legal')
const fullOracleInterval = 128
let publicOracleChecks = 0
const games = []
assert(Number.isInteger(searchDepthLimit) && searchDepthLimit >= 1 && searchDepthLimit <= 255, 'depth must be an integer between 1 and 255')

function movesFor (state, checkPublic = false) {
  if (!fastLegal) return legalMoves(rules, state)
  const moves = treeLegalMoves(state)
  if (checkPublic) {
    assert.deepEqual(moves, legalMoves(rules, state), 'selfplay tree traversal must match current public rules')
    publicOracleChecks++
  }
  return moves
}

const matchStarted = performance.now()
for (let pair = 0; pair < pairs; pair++) {
  const rng = random(seed + pair * 65537 + boardDepth * 1009)
  let opening = newState(rules, boardDepth)
  for (let ply = 0; ply < openingPlies; ply++) {
    const moves = movesFor(opening, true)
    assert(moves.length, 'opening ended before paired play')
    opening = advance(rules, opening, moves[Math.floor(rng() * moves.length)])
  }
  for (const currentColor of [1, 2]) {
    // The fast trajectory may mutate its tree, so each color game receives an
    // isolated opening copy. Search still checks exact Board restoration.
    let state = fastLegal ? structuredClone(opening) : opening
    const statistics = Array.from({ length: 2 }, () => ({ nodes: 0, ms: 0, searches: 0, depth: 0, maxMs: 0, overruns: 0 }))
    for (const engine of engines) engine.tt.clear()
    while (!state.root.winner) {
      if (fastLegal && (state.moves.length - openingPlies) % fullOracleInterval === 0) movesFor(state, true)
      const version = Number(state.player === currentColor)
      const result = searchPosition(engines[version], state, searchDepthLimit, budget, { clear: false, fastLegal, legalityEngine: rules })
      statistics[version].nodes += result.nodes
      statistics[version].ms += result.elapsed
      statistics[version].depth += result.depth
      statistics[version].searches++
      statistics[version].maxMs = Math.max(statistics[version].maxMs, result.elapsed)
      statistics[version].overruns += Number(result.elapsed > budget + 1)
      // advance always checks the chosen path with public isValidPath before
      // applying it, including when candidate enumeration uses traversal.
      state = advance(rules, state, result.move, { copy: !fastLegal })
    }
    const winner = state.root.winner
    const score = winner === 'Draw' ? 0.5 : winner === (currentColor === 1 ? 'X' : 'O') ? 1 : 0
    const game = { pair, currentColor: currentColor === 1 ? 'X' : 'O', opening: opening.moves, winner, score, plies: state.moves.length, statistics }
    games.push(game)
    console.error(`pair ${pair + 1}/${pairs}, current ${game.currentColor}: ${winner}, score ${score}, ${game.plies} plies`)
  }
}
const matchElapsedMs = performance.now() - matchStarted
const playedPlies = games.reduce((sum, game) => sum + game.plies - openingPlies, 0)
const points = games.reduce((sum, game) => sum + game.score, 0)
const rate = points / games.length
const elo = rate > 0 && rate < 1 ? 400 * Math.log10(rate / (1 - rate)) : null
const pairScores = Array.from({ length: pairs }, (_, index) => (games[index * 2].score + games[index * 2 + 1].score) / 2)
const mean = pairScores.reduce((sum, score) => sum + score, 0) / pairs
const variance = pairs > 1 ? pairScores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / (pairs - 1) : 0
const margin = 1.96 * Math.sqrt(variance / pairs)
const timing = Object.fromEntries(['baseline', 'current'].map((version, index) => {
  const statistics = games.map(game => game.statistics[index])
  const searches = statistics.reduce((sum, entry) => sum + entry.searches, 0)
  const ms = statistics.reduce((sum, entry) => sum + entry.ms, 0)
  return [version, {
    searches,
    meanSearchMs: ms / searches,
    maxSearchMs: Math.max(...statistics.map(entry => entry.maxMs)),
    overrunSearches: statistics.reduce((sum, entry) => sum + entry.overruns, 0),
  }]
}))
report({
  seed,
  boardDepth,
  searchDepthLimit,
  budget,
  pairs,
  matchElapsedMs,
  playedPliesPerSecond: playedPlies * 1000 / matchElapsedMs,
  legality: { mode: fastLegal ? 'tree' : 'public', publicOracleChecks, fullOracleInterval: fastLegal ? fullOracleInterval : 1, perMovePublicValidation: true, restorationSnapshots: true },
  wins: games.filter(game => game.score === 1).length,
  draws: games.filter(game => game.score === 0.5).length,
  losses: games.filter(game => game.score === 0).length,
  scoreRate: rate,
  approximatePaired95Interval: [Math.max(0, mean - margin), Math.min(1, mean + margin)],
  eloEstimate: elo,
  timing,
  games,
})
