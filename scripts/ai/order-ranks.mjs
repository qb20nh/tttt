import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argument, advance, boardOf, generatedMoves, loadEngine, moveOf, newState, random, report, snapshot, treeLegalMoves } from './harness.mjs'

const require = createRequire(import.meta.url)

export function validateOrderRanks (engine) {
  const started = performance.now()
  // Keep this optional module out of loadEngine: comparison runners must still
  // load historical engines that predate the compact ordering cache.
  const order = require(join(engine.output, 'src/game/ai/default/order-lookup.js'))
  const lookup = engine.lookup
  lookup.initTables()
  assert(order.LUT_ORDER_KEY_INDEX instanceof Uint16Array)
  assert(order.LUT_ORDER_RANK instanceof Uint16Array)
  assert.equal(order.LUT_ORDER_KEY_INDEX.length, 4 ** 9)
  assert.equal(order.LUT_ORDER_RANK.length, 3 ** 9 * 9)
  assert.equal(typeof order.computeOrderRank, 'function')
  const counts = { indexKeys: 0, ordinaryKeys: 0, drawKeys: 0, ranks: 0, ordinaryRanks: 0, drawFallbackRanks: 0, dynamicOrders: 0, rootWinOrders: 0, ordinaryTTOrders: 0, singleMoveOrders: 0, emptyOrders: 0 }

  // Reconstruct the original uncached ordering formula. Main LUT correctness
  // has its own geometric oracle in lookup-tables.mjs; neither cached ranks nor
  // computeOrderRank supplies any expected value here.
  function uncachedRank (key, player, relative) {
    const bit = 2 ** relative
    const nextKey = key + player * 4 ** relative
    const wins = player === 1 ? lookup.LUT_WIN_MOVES_X : lookup.LUT_WIN_MOVES_O
    const blocks = player === 1 ? lookup.LUT_WIN_MOVES_O : lookup.LUT_WIN_MOVES_X
    const localWin = (wins[key] & bit) !== 0
    let score = 2000
    if (localWin) score += 8000
    if ((blocks[key] & bit) !== 0) score += 4000
    if (lookup.LUT_WIN_STATUS_BASE4[nextKey] === 3) score += 50
    const delta = (lookup.LUT_SCORE_BASE4[nextKey] - lookup.LUT_SCORE_BASE4[key]) * (player === 1 ? 1 : -1)
    score += delta < -200 ? -200 : delta > 200 ? 200 : delta
    score += relative === 4 ? 30 : relative % 2 === 0 ? 12 : 0
    assert(score > 0 && score < 32768, 'static rank must fit below its local-win flag')
    return score + (localWin ? 32768 : 0)
  }

  const cells = new Array(9)
  for (let key = 0; key < 4 ** 9; key++) {
    let encoded = key
    let index = 0
    let hasDraw = false
    let colorKey = 0
    for (let relative = 0; relative < 9; relative++) {
      const cell = encoded % 4
      cells[relative] = cell
      encoded = Math.floor(encoded / 4)
      index += cell * 3 ** relative
      hasDraw ||= cell === 3
      const exchanged = cell === 1 ? 2 : cell === 2 ? 1 : cell
      colorKey += exchanged * 4 ** relative
    }
    assert.equal(order.LUT_ORDER_KEY_INDEX[key], hasDraw ? 65535 : index, `compact row index differs at key ${key}`)
    counts.indexKeys++
    counts[hasDraw ? 'drawKeys' : 'ordinaryKeys']++
    for (const player of [1, 2]) {
      const normalized = player === 1 ? key : colorKey
      const row = order.LUT_ORDER_KEY_INDEX[normalized]
      for (let relative = 0; relative < 9; relative++) {
        if (cells[relative] !== 0) continue
        const expected = uncachedRank(key, player, relative)
        const computed = order.computeOrderRank(normalized, relative)
        assert.equal(computed, expected, `normalized calculation differs at key ${key}, player ${player}, cell ${relative}`)
        const actual = row === 65535 ? computed : order.LUT_ORDER_RANK[row * 9 + relative]
        assert.equal(actual, expected, `cached static rank differs at key ${key}, player ${player}, cell ${relative}`)
        counts.ranks++
        counts[row === 65535 ? 'drawFallbackRanks' : 'ordinaryRanks']++
      }
    }
  }

  const fixtures = []
  const addCells = (depth, name, cells) => {
    const board = new engine.Board(depth)
    for (const [move, player] of cells) board.setCell(move, player)
    assert.equal(board.getWinner(), 0, `${name} must start open`)
    fixtures.push({ board, name })
    return board
  }
  addCells(1, 'D1-Draw-markers', [[0, 3], [1, 1], [4, 2]])
  addCells(2, 'D2-mixed-normal-Draw-rows', [[0, 3], [1, 1], [2, 2], [12, 3], [13, 1], [18, 2], [19, 3], [20, 3], [80, 3]])
  const single = addCells(2, 'D2-single-move', [1, 2, 1, 1, 2, 2, 2, 1].map((player, move) => [move, player]))
  single.constraint = 0
  single.constraintLayer = 1
  assert.deepEqual(generatedMoves(engine, single), [8])
  const terminal = new engine.Board(2)
  terminal.rootWinner = 3
  fixtures.push({ board: terminal, name: 'D2-terminal' })

  for (const depth of [2, 3, 4]) {
    const rng = random(0x6f726465 + depth * 1009)
    let state = newState(engine, depth)
    for (let ply = 0; ply <= 32; ply++) {
      if ([5, 16, 32].includes(ply)) {
        const board = boardOf(engine, state)
        assert.deepEqual(generatedMoves(engine, board), treeLegalMoves(state))
        fixtures.push({ board, name: `D${depth}-seeded-ply${ply}` })
      }
      const legal = treeLegalMoves(state)
      if (!legal.length || ply === 32) break
      state = advance(engine, state, legal[Math.floor(rng() * legal.length)], { copy: false })
    }
    for (const player of [1, 2]) {
      const board = new engine.Board(depth)
      const winNode = path => {
        if (path.length === depth) board.setCell(moveOf(path), player)
        else for (const cell of [0, 1, 2]) winNode([...path, cell])
      }
      const nearNode = path => {
        if (path.length === depth) return moveOf(path)
        winNode([...path, 0])
        winNode([...path, 1])
        return nearNode([...path, 2])
      }
      winNode([0])
      winNode([1])
      const rootWin = nearNode([2])
      const other = Array(depth - 1).fill(4)
      for (const cell of [3, 5]) board.setCell(moveOf([...other, cell]), player)
      for (const cell of [1, 7]) board.setCell(moveOf([...other, cell]), 3 - player)
      const unrelated = moveOf([...other, 4])
      assert.equal(board.getWinner(), 0)
      fixtures.push({ board, name: `D${depth}-root-win-${player}`, rootWin, unrelated, winningPlayer: player })
      const blocked = board.clone()
      blocked.setCell(rootWin, 3 - player)
      const quiet = generatedMoves(engine, blocked).find(move => move !== unrelated)
      assert.notEqual(quiet, undefined)
      fixtures.push({ board: blocked, name: `D${depth}-blocked-root-win-${player}`, unrelated, quiet, winningPlayer: player })
    }
  }

  for (const fixture of fixtures) {
    const { board } = fixture
    const legal = generatedMoves(engine, board)
    const before = snapshot(board)
    for (const player of [1, 2]) {
      const search = new engine.Search()
      for (let scenario = 0; scenario < 6; scenario++) {
        const offset = 13
        const ply = 3
        const input = [...legal]
        if (scenario % 3 === 1) input.reverse()
        else if (scenario % 3 === 2) input.sort((a, b) => (a * 7919) % 6561 - (b * 7919) % 6561)
        search.moves.fill(-12345)
        search.moves.set(input, offset)
        for (const move of legal) search.history[(player - 1) * 6561 + move] = scenario === 0 ? 0 : scenario === 5 ? 0x3fffffff : (move * 4099 + scenario * 7919) & 65535
        const preferred = fixture.unrelated ?? legal[0] ?? -1
        search.killers[ply * 2] = scenario >= 2 ? preferred : -1
        search.killers[ply * 2 + 1] = scenario === 0 ? -1 : scenario === 1 || scenario === 4 ? preferred : legal.at(-1) ?? -1
        const ttMove = scenario >= 3 ? fixture.quiet ?? preferred : -1
        const expected = legal.length === 1
          ? [...legal]
          : legal.map(move => {
            const relative = move % 9
            const key = board.keys[board.depth - 1][Math.floor(move / 9)]
            const rank = uncachedRank(key, player, relative)
            let score = rank % 32768
            score += Math.min(512, search.history[(player - 1) * 6561 + move] >>> 3)
            if (move === search.killers[ply * 2]) score += 700
            else if (move === search.killers[ply * 2 + 1]) score += 600
            if (move === ttMove) score += 16000
            if (rank >= 32768) {
              // Verify the root-win override by actually applying the move,
              // independently of Search.winsRoot's ancestor walk.
              board.setCell(move, player)
              if (board.getWinner() === player) score = 32767
              board.setCell(move, 0)
            }
            const packed = score * 65536 + move
            assert(packed >= 0 && packed <= 0x7fffffff, 'packed ordering must remain positive Int32')
            return packed
          }).sort((a, b) => a - b)
        assert.deepEqual(snapshot(board), before, 'independent ordering oracle must restore all board state')
        search.orderMoves(board, player, legal.length, offset, ply, ttMove)
        const actual = [...search.moves.subarray(offset, offset + legal.length)]
        assert.deepEqual(actual, expected, `${fixture.name}, player ${player}, context ${scenario}: packed order differs from original formula`)
        assert.equal(search.moves[offset - 1], -12345, 'ordering must respect its starting offset')
        assert.equal(search.moves[offset + legal.length], -12345, 'ordering must respect its move count')
        assert.deepEqual(actual.map(value => value & 65535).sort((a, b) => a - b), legal, 'ordering must preserve the complete legal set')
        assert.deepEqual(snapshot(board), before, 'actual ordering must preserve all board state')
        if (fixture.rootWin !== undefined && player === fixture.winningPlayer) {
          assert.equal(actual.at(-1) & 65535, fixture.rootWin, 'root win must precede TT, killers, saturated history, and local threats')
          counts.rootWinOrders++
        }
        if (fixture.quiet !== undefined && player === fixture.winningPlayer && scenario === 5) {
          assert.equal(actual.at(-1) & 65535, fixture.quiet, 'ordinary TT preference must stay ahead when the root win is blocked')
          counts.ordinaryTTOrders++
        }
        counts.dynamicOrders++
        if (legal.length === 1) counts.singleMoveOrders++
        if (legal.length === 0) counts.emptyOrders++
      }
    }
  }
  assert(counts.rootWinOrders > 0 && counts.ordinaryTTOrders > 0 && counts.drawFallbackRanks > 0 && counts.singleMoveOrders > 0 && counts.emptyOrders > 0)
  return { passed: true, elapsedMs: performance.now() - started, counts, storageBytes: order.LUT_ORDER_KEY_INDEX.byteLength + order.LUT_ORDER_RANK.byteLength }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  report(validateOrderRanks(loadEngine(resolve(argument('engine', '.')))))
}
