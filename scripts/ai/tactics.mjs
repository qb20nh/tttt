import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argument, generatedMoves, loadEngine, report, snapshot } from './harness.mjs'

export function validateRootWinTactics (engine) {
  const cases = []

  function capturePosition (depth, player) {
    const board = new engine.Board(depth)
    const moveOf = path => path.reduce((move, cell) => move * 9 + cell, 0)
    const winNode = (path) => {
      if (path.length === depth) {
        board.setCell(moveOf(path), player)
        return
      }
      for (const cell of [0, 1, 2]) winNode([...path, cell])
    }
    const nearNode = (path) => {
      if (path.length === depth) return moveOf(path)
      winNode([...path, 0])
      winNode([...path, 1])
      return nearNode([...path, 2])
    }
    winNode([0])
    winNode([1])
    const rootWin = nearNode([2])
    const otherBoard = Array(depth - 1).fill(4)
    for (const cell of [3, 5]) board.setCell(moveOf([...otherBoard, cell]), player)
    // This unrelated center capture also blocks the opponent's local threat.
    for (const cell of [1, 7]) board.setCell(moveOf([...otherBoard, cell]), 3 - player)
    return { board, rootWin, unrelated: moveOf([...otherBoard, 4]) }
  }

  function orderedMoves (board, player, ttMove, killerMove) {
    const search = new engine.Search()
    const moves = generatedMoves(engine, board)
    search.moves.set(moves)
    search.history.fill(4096)
    search.killers[0] = killerMove
    const before = snapshot(board)
    search.orderMoves(board, player, moves.length, 0, 0, ttMove)
    const packed = [...search.moves.subarray(0, moves.length)]
    assert(packed.every(move => move >= 0), 'ordering ranks must fit the signed packed representation')
    assert.deepEqual(packed.map(move => move & 0xffff).sort((a, b) => a - b), moves, 'ordering must preserve every legal move')
    assert.deepEqual(snapshot(board), before, 'ordering must not change board state or caches')
    // Search consumes ascending positive packed ranks from the end.
    return packed.reverse().map(move => move & 0xffff)
  }

  for (const depth of [2, 3, 4]) {
    for (const player of [1, 2]) {
      engine.tt.clear()
      const { board, rootWin, unrelated } = capturePosition(depth, player)
      assert.equal(board.getWinner(), 0, 'capture fixture must begin before game end')
      const before = snapshot(board)
      board.setCell(unrelated, player)
      assert.equal(board.getWinner(), 0, 'the tempting center capture must leave the root open')
      board.setCell(unrelated, 0)
      assert.deepEqual(snapshot(board), before)

      assert.equal(orderedMoves(board, player, unrelated, unrelated)[0], rootWin, 'immediate root win must beat TT, killer, history, and local capture preferences')
      const fallback = new engine.Search().search(board, player, 1, 0)
      assert.equal(fallback.move, rootWin, 'zero-time fallback must take the immediate root win')
      assert.deepEqual(snapshot(board), before, 'zero-time fallback must restore its input')
      board.setCell(fallback.move, player)
      assert.equal(board.getWinner(), player, 'chosen fallback must actually win the root')
      board.setCell(fallback.move, 0)
      assert.deepEqual(snapshot(board), before, 'winning move undo must restore caches and hash')

      const fixed = new engine.Search().search(board, player, 1, 1000)
      assert.equal(fixed.move, rootWin)
      assert.equal(fixed.score, 99999, 'one-ply win must retain its exact mate score')
      assert.deepEqual(snapshot(board), before, 'completed search must restore its input')

      engine.tt.clear()
      const fullSearch = new engine.Search()
      const full = fullSearch.alphaBeta(board, player, 7, -Infinity, Infinity, 0, false)
      assert.equal(full.move, rootWin)
      assert.equal(full.score, 99999, 'full-depth search must prove the immediate root win')
      assert(fullSearch.nodesVisited <= 2, 'a proved one-ply win must skip slower alternatives')
      assert.deepEqual(snapshot(board), before, 'mate-ceiling exit must restore its input')

      // Block the cascade: ordinary TT preference and local tactical ordering
      // must still work when no move immediately wins the root.
      board.setCell(rootWin, 3 - player)
      const blocked = snapshot(board)
      const legal = generatedMoves(engine, board)
      for (const move of legal) {
        board.setCell(move, player)
        assert.notEqual(board.getWinner(), player, 'counterpart must have no immediate root win')
        board.setCell(move, 0)
      }
      assert.deepEqual(snapshot(board), blocked)
      const quiet = legal.find(move => move !== unrelated)
      assert.notEqual(quiet, undefined)
      const ordinary = orderedMoves(board, player, quiet, unrelated)
      assert.equal(ordinary[0], quiet, 'ordinary TT preference must stay first')
      assert.equal(ordinary[1], unrelated, 'local win and block must stay ahead of quiet alternatives')
      cases.push({ boardDepth: depth, player, rootWin, zeroTimeMove: fallback.move, fullDepthNodes: fullSearch.nodesVisited })
    }
  }
  return { passed: true, cases }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  report(validateRootWinTactics(loadEngine(resolve(argument('engine', '.')))))
}
