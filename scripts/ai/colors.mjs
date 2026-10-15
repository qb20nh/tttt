import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argument, boardOf, generatedMoves, loadEngine, newState, pathOf, report, searchPosition, snapshot } from './harness.mjs'

function swapColors (state) {
  const swapped = structuredClone(state)
  const swap = value => value === 'X' ? 'O' : value === 'O' ? 'X' : value
  const visit = (node) => {
    node.value = swap(node.value)
    node.winner = swap(node.winner)
    if (node.children) node.children.forEach(visit)
  }
  visit(swapped.root)
  swapped.player = 3 - state.player
  return swapped
}

function atPath (state, path) {
  return path.reduce((node, index) => node.children[index], state.root)
}

export function validateColorSymmetry (engine) {
  const cases = []
  let freeCases = 0
  let constrainedCases = 0
  let explicitClosures = 0
  let halfPointCases = 0

  function check (name, state) {
    const board = boardOf(engine, state)
    const swapped = boardOf(engine, swapColors(state))
    const before = snapshot(board)
    const swappedBefore = snapshot(swapped)
    assert(board.evaluate(1) === swapped.evaluate(2), `${name}: X evaluation must survive swapping colors and player`)
    assert(board.evaluate(2) === swapped.evaluate(1), `${name}: O evaluation must survive swapping colors and player`)
    const winner = board.getWinner()
    assert.equal(swapped.getWinner(), winner === 1 || winner === 2 ? 3 - winner : winner, `${name}: color swap must preserve terminal outcome`)
    assert.deepEqual(generatedMoves(engine, swapped), generatedMoves(engine, board), `${name}: color swap must preserve legal moves`)
    assert.equal(swapped.constraint, board.constraint, `${name}: color swap must preserve target`)
    assert.equal(swapped.constraintLayer, board.constraintLayer, `${name}: color swap must preserve target layer`)
    for (const candidate of [board, swapped]) {
      const rebuilt = candidate.clone()
      rebuilt.rebuildEvaluation()
      assert.deepEqual(snapshot(rebuilt), snapshot(candidate), `${name}: imported evaluation must match a full rebuild`)
    }
    assert.deepEqual(snapshot(board), before, `${name}: evaluation checks must preserve original state`)
    assert.deepEqual(snapshot(swapped), swappedBefore, `${name}: evaluation checks must preserve swapped state`)
    if (board.constraint === -1) freeCases++
    else constrainedCases++
    cases.push({ name, boardDepth: state.depth, evaluation: before.evaluation })
  }

  for (const depth of [1, 2, 3, 4]) {
    const size = 9 ** depth
    const fixtures = [
      ['empty', []],
      ['edge', [[1, 'X']]],
      ['center', [[4, 'X']]],
      ['corner', [[0, 'X']]],
      ['opposing-threats', [[0, 'X'], [1, 'X'], [3, 'O'], [7, 'O']]],
      ['distributed', [[0, 'X'], [size - 1, 'O'], [Math.floor(size / 2), 'X'], [Math.floor(size / 3), 'O']]],
    ]
    if (depth === 4) fixtures.push(['independent-edges', [[1, 'X'], [3, 'X']]])
    for (const [name, leaves] of fixtures) {
      const state = newState(engine, depth)
      for (const [move, value] of leaves) atPath(state, pathOf(move, depth)).value = value
      for (const constraint of depth === 1 ? [[]] : [[], Array(depth - 1).fill(0)]) {
        const targeted = { ...state, constraint }
        check(`D${depth}-${name}-${constraint.length ? 'targeted' : 'free'}`, targeted)
        if (depth === 4 && (name === 'edge' || name === 'independent-edges')) {
          // Each edge belongs to two independent lines. At weight 1/16,
          // one edge contributes 1.25; edges 1/3 contribute 2.5 together.
          const expected = name === 'edge' ? 1 : 3
          const board = boardOf(engine, targeted)
          const bonus = constraint.length ? 0 : 20
          assert.equal(board.evaluate(1), expected + bonus, `D4 ${name} must round positive fractions correctly`)
          assert.equal(boardOf(engine, swapColors(targeted)).evaluate(1), -expected + bonus, `D4 ${name} must round negative fractions symmetrically`)
          if (name === 'independent-edges') halfPointCases++
        }
      }
    }

    if (depth > 1) {
      const closed = newState(engine, depth)
      closed.root.children[0].winner = 'Draw'
      closed.root.children[1].winner = 'X'
      closed.root.children[2].winner = 'O'
      // Descendants need not be full in persisted explicit closures.
      atPath(closed, pathOf(1, depth)).value = 'X'
      atPath(closed, pathOf(size - 2, depth)).value = 'O'
      if (depth > 2) closed.root.children[4].children[0].winner = 'Draw'
      for (const constraint of [[], Array(depth - 1).fill(8)]) {
        check(`D${depth}-explicit-closures-${constraint.length ? 'targeted' : 'free'}`, { ...closed, constraint })
        explicitClosures++
      }
    }
    for (const winner of ['X', 'O', 'Draw']) {
      const terminal = newState(engine, depth)
      terminal.root.winner = winner
      check(`D${depth}-explicit-root-${winner}`, terminal)
      explicitClosures++
    }
  }
  // Five owned root sectors create many threats without a completed line.
  // Large D4 weights must clamp below the search's 90000 mate threshold,
  // including the free-move bonus, and must not stop iterative deepening.
  const dense = newState(engine, 4)
  for (const index of [0, 2, 3, 7, 8]) dense.root.children[index].winner = 'X'
  check('D4-dense-ownership-ceiling', dense)
  explicitClosures++
  const denseBoard = boardOf(engine, dense)
  assert.equal(denseBoard.getWinner(), 0, 'dense ownership fixture must remain nonterminal')
  assert.equal(denseBoard.evaluate(1), 89020, 'D4 free evaluation must include the bounded 89000 score and 20 bonus')
  assert(denseBoard.evaluate(1) < 90000, 'D4 heuristic ceiling must remain below mate scores')
  const bounded = searchPosition(engine, dense, 2, 10000)
  assert(Math.abs(bounded.score) < 90000, 'dense D4 heuristic must not be reported as a proved mate')
  assert.equal(bounded.depth, 2, 'nonterminal D4 heuristic must complete both requested iterations')
  const heuristicCeiling = { boardDepth: 4, evaluation: denseBoard.evaluate(1), score: bounded.score, depth: bounded.depth, nodes: bounded.nodes }
  assert(freeCases > 0 && constrainedCases > 0 && halfPointCases === 2 && explicitClosures > 0, 'color suite must include free/targeted, half-point, and explicit closure cases')
  return { passed: true, freeCases, constrainedCases, explicitClosures, halfPointCases, heuristicCeiling, cases }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  report(validateColorSymmetry(loadEngine(resolve(argument('engine', '.')))))
}
