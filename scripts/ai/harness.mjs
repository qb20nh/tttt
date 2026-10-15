import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const patterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

export function random (seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let next = Math.imul(value ^ (value >>> 15), 1 | value)
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

// Each version gets its own CommonJS module cache and transposition table.
// A transpiled temporary copy also leaves the browser build untouched.
export function loadEngine (sourceRoot = repository, seed = 0x74647474) {
  const output = mkdtempSync(join(tmpdir(), 'tttt-ai-run-'))
  writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}\n')
  const copy = (directory) => {
    for (const entry of readdirSync(join(sourceRoot, directory), { withFileTypes: true })) {
      const relative = join(directory, entry.name)
      if (entry.isDirectory()) copy(relative)
      else if (entry.name.endsWith('.ts')) {
        const target = join(output, relative.replace(/\.ts$/, '.js'))
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, ts.transpileModule(readFileSync(join(sourceRoot, relative), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText)
      }
    }
  }
  copy('src/game')
  const oldRandom = Math.random
  Math.random = random(seed)
  try {
    return {
      Board: require(join(output, 'src/game/ai/default/board.js')).Board,
      BoardAdapter: require(join(output, 'src/game/ai/default/adapter.js')).BoardAdapter,
      MoveGen: require(join(output, 'src/game/ai/default/movegen.js')).MoveGen,
      Search: require(join(output, 'src/game/ai/default/search.js')).Search,
      tt: require(join(output, 'src/game/ai/default/transposition.js')).tt,
      TT: require(join(output, 'src/game/ai/default/transposition.js')).TT,
      lookup: require(join(output, 'src/game/ai/default/lookup.js')),
      logic: require(join(output, 'src/game/logic.js')),
      symmetry: require(join(output, 'src/game/ai/symmetry.js')),
      sourceRoot,
      output,
    }
  } finally {
    Math.random = oldRandom
  }
}

export function captureBaseline (target) {
  mkdirSync(target, { recursive: true })
  // Capture a commit, never a working tree that another agent may be editing.
  const archive = execFileSync('git', ['archive', 'HEAD', 'src/game'], { cwd: repository })
  execFileSync('tar', ['-x', '-C', target], { input: archive })
  writeFileSync(join(target, 'revision.txt'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository }))
}

export function pathOf (move, depth) {
  const path = new Array(depth)
  for (let i = depth - 1; i >= 0; i--) {
    path[i] = move % 9
    move = Math.floor(move / 9)
  }
  return path
}

export function moveOf (path) {
  return path.reduce((move, digit) => move * 9 + digit, 0)
}

export function newState (engine, depth) {
  return { root: engine.logic.generateBoard(depth), constraint: [], player: 1, depth, moves: [], releases: 0, draws: 0 }
}

export function legalMoves (engine, state) {
  if (state.root.winner) return []
  const moves = []
  for (let move = 0; move < 9 ** state.depth; move++) {
    const path = pathOf(move, state.depth)
    if (state.constraint.every((digit, index) => digit === path[index]) && engine.logic.isValidPath(state.root, path)) moves.push(move)
  }
  return moves
}

// Traverse only the constrained subtree for long D3/D4 legal trajectories.
// This rule oracle does not share the AI's packed keys or generation logic.
export function treeLegalMoves (state) {
  if (state.root.winner) return []
  let node = state.root
  let index = 0
  for (const digit of state.constraint) {
    node = node.children?.[digit]
    if (!node || node.winner) return []
    index = index * 9 + digit
  }
  const moves = []
  const visit = (target, layer, offset) => {
    if (target.winner) return
    if (layer === state.depth) {
      if (target.value === null) moves.push(offset)
      return
    }
    for (let child = 0; child < 9; child++) visit(target.children[child], layer + 1, offset * 9 + child)
  }
  visit(node, state.constraint.length, index)
  return moves
}

// Reproduce the public game's move contract, independent of the AI's packed board.
export function advance (engine, state, move, { copy = true } = {}) {
  const path = pathOf(move, state.depth)
  assert(state.constraint.every((digit, index) => digit === path[index]), 'move violates UI constraint')
  assert(engine.logic.isValidPath(state.root, path), 'move violates UI legality')
  const root = copy ? structuredClone(state.root) : state.root
  const nodes = [root]
  let node = root
  for (let i = 0; i < state.depth - 1; i++) {
    node = node.children[path[i]]
    nodes.push(node)
  }
  node.children[path.at(-1)].value = state.player === 1 ? 'X' : 'O'
  const wonDepth = engine.logic.getWonDepth(nodes, state.depth)
  const constraint = engine.logic.getNextConstraint(path, wonDepth)
  const playable = (target) => {
    let targetNode = root
    if (targetNode.winner) return false
    for (const digit of target) {
      targetNode = targetNode.children[digit]
      if (targetNode.winner) return false
    }
    return !engine.logic.isFull(targetNode)
  }
  const initialLength = constraint.length
  while (constraint.length && !playable(constraint)) constraint.pop()
  if (!root.winner && !engine.logic.canWin(root, 'X') && !engine.logic.canWin(root, 'O')) root.winner = 'Draw'
  return {
    ...state,
    root,
    constraint,
    player: 3 - state.player,
    moves: [...state.moves, move],
    releases: state.releases + Number(initialLength > constraint.length),
    draws: state.draws + Number(wonDepth === state.depth && engine.logic.isFull(node)),
  }
}

export function boardOf (engine, state) {
  return engine.BoardAdapter.toBoard(state.root, state.depth, state.constraint)
}

export function generatedMoves (engine, board) {
  const output = new Int32Array(board.leaves.length)
  const count = engine.MoveGen.generate(board, output, 0)
  return [...output.subarray(0, count)].sort((a, b) => a - b)
}

export function snapshot (board) {
  return {
    leaves: [...board.leaves],
    keys: board.keys.map(layer => [...layer]),
    hash: board.hash,
    constraint: board.constraint,
    constraintLayer: board.constraintLayer,
    winner: board.getWinner(),
    evaluation: [board.evaluate(1), board.evaluate(2)],
  }
}

export function searchPosition (engine, state, maxDepth, budget, { clear = true, fastLegal = false, legalityEngine = engine } = {}) {
  if (clear) engine.tt.clear()
  const board = boardOf(engine, state)
  const before = snapshot(board)
  const started = performance.now()
  // Workers retain one Search instance across turns. Keep its ordering history
  // and preallocated buffers for warm runs; cold measurements start fresh.
  if (clear || !engine.searcher) engine.searcher = new engine.Search()
  const result = engine.searcher.search(board, state.player, maxDepth, budget)
  const elapsed = performance.now() - started
  assert.deepEqual(snapshot(board), before, 'search must restore the input board, including on timeout')
  const legal = fastLegal ? treeLegalMoves(state) : legalMoves(legalityEngine, state)
  assert(legal.length ? legal.includes(result.move) : result.move === -1, `search returned illegal move ${result.move}`)
  return { ...result, elapsed }
}

// A seeded random legal trajectory supplies opening, middle and endgame positions.
// Position selection never depends on either engine's score or match results.
export function positionSuite (engine, depths = [2, 3, 4], count = 6, seed = 20261013) {
  const positions = []
  for (const depth of depths) {
    for (let sample = 0; sample < count; sample++) {
      const rng = random(seed + depth * 1009 + sample * 65537)
      let state = newState(engine, depth)
      const target = [1, Math.floor(9 ** depth * 0.15), Math.floor(9 ** depth * 0.4)][sample % 3]
      for (let ply = 0; ply < target; ply++) {
        const legal = legalMoves(engine, state)
        if (!legal.length) break
        const next = advance(engine, state, legal[Math.floor(rng() * legal.length)])
        if (next.root.winner) break
        state = next
      }
      positions.push({ name: `D${depth}-seed${sample}-ply${state.moves.length}`, state })
    }
  }
  return positions
}

export function argument (name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

export function report (value) {
  const json = JSON.stringify(value, null, 2)
  const output = argument('output', '')
  if (output) writeFileSync(resolve(output), `${json}\n`)
  console.log(json)
}
