import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  advance, argument, boardOf, generatedMoves, loadEngine, newState,
  pathOf, random, report, snapshot, treeLegalMoves,
} from './harness.mjs'

export function validateLeafWins (engine) {
  const search = new engine.Search()
  const counts = { checks: 0, positives: 0, negatives: 0, trajectoryPositions: 0, syntheticPositions: 0, terminalPositions: 0, publicCandidates: 0 }

  function fullSnapshot (board) {
    return {
      ...snapshot(board),
      ...Object.fromEntries(['possibleKeys', 'possibleWins', 'childScores', 'subtreeScores'].map(field => [field, board[field].map(layer => [...layer])])),
    }
  }

  function normalized (state) {
    const constraint = [...state.constraint]
    const playable = path => {
      let node = state.root
      if (node.winner) return false
      for (const index of path) {
        node = node.children[index]
        if (node.winner) return false
      }
      return !engine.logic.isFull(node)
    }
    while (constraint.length && !playable(constraint)) constraint.pop()
    return { ...state, constraint }
  }

  // Use public tree rules, with no packed keys, lookup masks, or AI make/undo.
  // Only the selected path can change; restore its values and winner metadata.
  function winsAfter (state, move) {
    const path = pathOf(move, state.depth)
    assert(engine.logic.isValidPath(state.root, path), 'reference candidate must be legal under public rules')
    assert(state.constraint.every((index, layer) => path[layer] === index), 'reference candidate must obey the target')
    const nodes = [state.root]
    let leaf = state.root
    for (let layer = 0; layer < state.depth; layer++) {
      leaf = leaf.children[path[layer]]
      if (layer < state.depth - 1) nodes.push(leaf)
    }
    const saved = nodes.map(node => [node.winner, node.winPattern])
    const value = leaf.value
    try {
      leaf.value = state.player === 1 ? 'X' : 'O'
      engine.logic.getWonDepth(nodes, state.depth)
      counts.publicCandidates++
      return state.root.winner === leaf.value
    } finally {
      leaf.value = value
      nodes.forEach((node, index) => { [node.winner, node.winPattern] = saved[index] })
    }
  }

  function check (input, name) {
    const state = normalized(input)
    const board = boardOf(engine, input)
    const before = fullSnapshot(board)
    const treeBefore = JSON.stringify(state.root)
    const legal = treeLegalMoves(state)
    assert.deepEqual(generatedMoves(engine, board), legal, `${name}: AI legality must match the public tree`)
    const immediate = legal.some(move => winsAfter(state, move))
    assert.equal(JSON.stringify(state.root), treeBefore, `${name}: public reference must restore the entire tree`)
    const winner = state.root.winner
    const expected = winner
      ? winner === 'Draw' ? 0 : winner === (state.player === 1 ? 'X' : 'O') ? 100000 : -100000
      : immediate ? 99999 : board.evaluate(state.player)
    const result = search.alphaBeta(board, state.player, 0, -Infinity, Infinity, 0, false)
    assert(result.score === expected, `${name}: depth-zero score differs from the independent one-move oracle`)
    assert.deepEqual(fullSnapshot(board), before, `${name}: search must restore every Board cache`)
    counts.checks++
    counts[immediate ? 'positives' : 'negatives']++
  }

  function checkTargets (state, name) {
    const free = { ...state, constraint: [] }
    const variants = [state.constraint, []]
    const legal = treeLegalMoves(free)
    if (state.depth > 1 && legal.length) {
      for (const move of [legal[0], legal.at(-1)]) variants.push(pathOf(move, state.depth).slice(0, -1))
    }
    if (state.depth > 2) variants.push([2])
    const targets = new Map(variants.map(constraint => [constraint.join(','), constraint]))
    for (const constraint of targets.values()) {
      for (const player of [1, 2]) check({ ...state, constraint, player }, `${name}/target${constraint}/P${player}`)
    }
  }

  for (const depth of [2, 3, 4]) {
    const rng = random(20441014 + depth * 1009)
    let state = newState(engine, depth)
    const samples = new Set([0, 1, 4, 12, 24, 48, 96, 160])
    for (let ply = 0; ply <= 160; ply++) {
      if (samples.has(ply) || state.root.winner) {
        checkTargets(state, `D${depth}-history-${state.moves.length}`)
        counts.trajectoryPositions++
      }
      if (state.root.winner || ply === 160) break
      const legal = treeLegalMoves(state)
      assert(legal.length, 'nonterminal public trajectory must have a move')
      state = advance(engine, state, legal[Math.floor(rng() * legal.length)], { copy: false })
    }
  }

  function cascade (depth, player, closedLayer = -1) {
    const state = newState(engine, depth)
    const side = player === 1 ? 'X' : 'O'
    let node = state.root
    for (let layer = 0; layer < depth - 1; layer++) {
      node.children[0].winner = side
      node.children[1].winner = side
      node = node.children[2]
      if (layer + 1 === closedLayer) node.winner = 'Draw'
    }
    node.children[0].value = side
    node.children[1].value = side
    return state
  }

  for (const depth of [1, 2, 3, 4]) {
    for (const player of [1, 2]) {
      const side = player === 1 ? 'X' : 'O'
      for (const blocked of [false, true]) {
        const state = cascade(depth, player)
        if (blocked) {
          if (depth > 1) state.root.children[0].winner = 'Draw'
          else state.root.children[2].value = player === 1 ? 'O' : 'X'
        }
        checkTargets(state, `D${depth}-cascade-${side}-${blocked}`)
        if (depth > 1) check({ ...state, player, constraint: Array(depth - 1).fill(2) }, `D${depth}-pinned-${side}-${blocked}`)
        counts.syntheticPositions++
      }
      for (let closedLayer = 1; closedLayer < depth; closedLayer++) {
        const state = cascade(depth, player, closedLayer)
        state.constraint = Array(depth - 1).fill(2)
        checkTargets(state, `D${depth}-closed-layer${closedLayer}-${side}`)
        counts.syntheticPositions++
      }
      if (depth > 1) {
        const state = newState(engine, depth)
        for (const index of [0, 1, 3]) state.root.children[index].winner = side
        let node = state.root.children[6]
        for (let layer = 1; layer < depth - 1; layer++) {
          node.children[0].winner = side
          node.children[1].winner = side
          node = node.children[2]
        }
        node.children[0].value = side
        node.children[1].value = side
        checkTargets(state, `D${depth}-later-mask-${side}`)
        counts.syntheticPositions++
      }
      const terminal = cascade(depth, player)
      terminal.root.winner = 'Draw'
      checkTargets(terminal, `D${depth}-explicit-root-draw-${side}`)
      counts.terminalPositions++
    }
  }

  const tactics = []
  for (const player of [1, 2]) {
    const state = newState(engine, 2)
    const own = player === 1 ? 'X' : 'O'
    const opponent = player === 1 ? 'O' : 'X'
    state.player = player
    state.constraint = [4]
    for (const index of [0, 1]) {
      state.root.children[index].winner = opponent
      state.root.children[2].children[index].value = opponent
      state.root.children[4].children[index].value = own
    }
    const losing = advance(engine, state, 38)
    const winningReplies = treeLegalMoves(losing).filter(move => winsAfter(losing, move))
    assert.deepEqual(winningReplies, [20], 'tempting sector capture must allow an immediate opponent root win')
    engine.tt.clear()
    const board = boardOf(engine, state)
    const before = fullSnapshot(board)
    const result = new engine.Search().alphaBeta(board, player, 1, -Infinity, Infinity, 0, false)
    assert(treeLegalMoves(state).includes(result.move), 'tactical choice must be publicly legal')
    assert.notEqual(result.move, 38, 'one-ply search must avoid routing the opponent to its root-winning cascade')
    const chosen = advance(engine, state, result.move)
    assert(!treeLegalMoves(chosen).some(move => winsAfter(chosen, move)), 'chosen alternative must avoid an immediate root-winning reply')
    assert.deepEqual(fullSnapshot(board), before, 'tactical search must restore every Board cache')
    tactics.push({ player, temptingMove: 38, losingReply: 20, chosenMove: result.move, score: result.score })
  }
  engine.tt.clear()
  assert(counts.positives >= 8 && counts.negatives > counts.positives, 'oracle must cover wins and absent/blocked wins at every depth')
  return { passed: true, counts, tactics }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  report(validateLeafWins(loadEngine(resolve(argument('engine', '.')))))
}
