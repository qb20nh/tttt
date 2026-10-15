import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEngine, argument, report, newState, boardOf, generatedMoves, pathOf, moveOf } from './harness.mjs'

// Independent coordinate construction of the square's eight symmetries.
const maps = []
for (const reflected of [false, true]) {
  for (let rotations = 0; rotations < 4; rotations++) {
    maps.push(Array.from({ length: 9 }, (_, digit) => {
      let x = digit % 3
      let y = Math.floor(digit / 3)
      if (reflected) x = 2 - x
      for (let rotation = 0; rotation < rotations; rotation++) [x, y] = [2 - y, x]
      return y * 3 + x
    }))
  }
}

export function validateOpeningOrbits (engine) {
  assert.equal(typeof engine.symmetry.getOpeningMoves, 'function', 'opening-orbit API is required')
  const counts = []
  for (const [depth, expectedCount] of [[1, 3], [2, 15], [3, 105], [4, 861]]) {
    const canonical = (move) => Math.max(...maps.map(map => moveOf(pathOf(move, depth).map(digit => map[digit]))))
    const expected = [...new Set(Array.from({ length: 9 ** depth }, (_, move) => canonical(move)))].sort((a, b) => a - b)
    const representatives = [...engine.symmetry.getOpeningMoves(depth)].sort((a, b) => a - b)
    assert.equal(representatives.length, expectedCount, `D${depth} representative count must match Burnside's lemma`)
    assert.equal(new Set(representatives).size, representatives.length, 'opening representatives must be unique')
    assert.deepEqual(representatives, expected, `D${depth} representatives must cover every global symmetry orbit exactly once`)
    assert(representatives.every(move => canonical(move) === move), 'opening representatives must be maximum flat indices in their orbits')

    const search = new engine.Search()
    const empty = boardOf(engine, newState(engine, depth))
    search.setOpeningMoves(empty)
    assert.deepEqual([...search.openingMoves].sort((a, b) => a - b), expected, 'unrestricted empty board must enable root orbit reduction')
    assert.equal(search.generateMoves(empty, 0, 0), expectedCount, 'root search must enumerate one move per orbit')
    assert.equal(search.generateMoves(empty, 0, 1), 9 ** depth, 'orbit reduction must apply only at the root')

    const occupied = empty.clone()
    occupied.setCell(0, 1)
    search.setOpeningMoves(occupied)
    assert.equal(search.openingMoves, null, 'nonempty position must reset prior opening reduction')
    assert.equal(search.generateMoves(occupied, 0, 0), generatedMoves(engine, occupied).length, 'nonempty root must use ordinary legal generation')

    if (depth > 1) {
      const constrained = empty.clone()
      constrained.constraint = 0
      constrained.constraintLayer = depth - 1
      search.setOpeningMoves(constrained)
      assert.equal(search.openingMoves, null, 'nonfree position must disable opening reduction')
      for (const winner of ['X', 'Draw']) {
        const explicit = newState(engine, depth)
        explicit.root.children[0].winner = winner
        const closed = boardOf(engine, explicit)
        assert(closed.leaves.every(value => value === 0), 'explicit closure fixture must retain empty descendants')
        search.setOpeningMoves(closed)
        assert.equal(search.openingMoves, null, 'explicit intermediate closure must disable opening reduction')
      }
    }
    for (const winner of ['X', 'O', 'Draw']) {
      const explicit = newState(engine, depth)
      explicit.root.winner = winner
      search.setOpeningMoves(boardOf(engine, explicit))
      assert.equal(search.openingMoves, null, 'explicit root closure must disable opening reduction')
    }
    search.setOpeningMoves(empty)
    const terminal = newState(engine, depth)
    terminal.root.winner = 'Draw'
    assert.equal(search.search(boardOf(engine, terminal), 1, 1, 1000).move, -1, 'terminal search must return no move')
    const afterTerminal = search.search(occupied, 2, 1, 1000)
    assert(generatedMoves(engine, occupied).includes(afterTerminal.move), 'nonterminal search after terminal call must return an ordinary legal move')
    assert.equal(search.openingMoves, null, 'nonterminal search after terminal call must reset prior opening reduction')
    counts.push({ depth, representatives: expectedCount, totalMoves: 9 ** depth })
  }
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const engine = loadEngine(resolve(argument('engine', '.')))
  report({ passed: true, openingOrbits: validateOpeningOrbits(engine) })
}
