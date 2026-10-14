import { Search } from './default/search'
import { BoardAdapter } from './default/adapter'
import type { BoardNode, Player } from '../types'
import { CELL_X, CELL_O } from './default/constants'
import { tt } from './default/transposition'
import { isValidPath } from '../logic'

type WorkerMessage =
  | {
    type: 'search'
    id: number
    board: BoardNode
    player: Player
    constraint: number[]
    config: { maxTime: number; maxDepth: number; boardDepth: number }
  }
  | {
    type: 'benchmark'
    board: BoardNode
    player: Player
    constraint: number[]
    config: { maxTime: number; maxDepth: number; boardDepth: number }
  }
  | { type: 'clear' }

const engine = new Search()
const MOVE_PREFERENCE = [4, 0, 2, 6, 8, 1, 3, 5, 7]

const toPath = (move: number, depth: number): number[] => {
  if (!Number.isInteger(move) || move < 0 || move >= Math.pow(9, depth)) return []
  const path = new Array<number>(depth)
  for (let i = depth - 1; i >= 0; i--) {
    path[i] = move % 9
    move = Math.floor(move / 9)
  }
  return path
}

const isLegalMove = (board: BoardNode, path: number[], constraint: number[], depth: number): boolean => {
  return path.length === depth &&
    constraint.every((index, i) => path[i] === index) &&
    isValidPath(board, path)
}

// Search failures must still produce a legal move without starting another full
// search after the original deadline. Traverse the authoritative game tree.
const findLegalMove = (board: BoardNode, constraint: number[], depth: number): number[] => {
  const path: number[] = []
  const visit = (node: BoardNode, layer: number): boolean => {
    if (node.winner) return false
    if (layer === depth) return !node.children && node.value === null
    if (!node.children) return false

    const choices = layer < constraint.length ? [constraint[layer]] : MOVE_PREFERENCE
    for (const index of choices) {
      if (!node.children[index]) continue
      path.push(index)
      if (visit(node.children[index], layer + 1)) return true
      path.pop()
    }
    return false
  }
  return visit(board, 0) ? path : []
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  if (msg.type === 'search') {
    const { board: boardNode, player, constraint, config, id } = msg
    const start = performance.now()
    try {
      // Keep one coordinate system across turns so prior searches remain useful
      // in the transposition table and no recursive symmetry clone is needed.
      const board = BoardAdapter.toBoard(boardNode, config.boardDepth, constraint)
      const pVal = player === 'X' ? CELL_X : CELL_O
      const remainingTime = Math.max(0, config.maxTime - (performance.now() - start))
      const result = engine.search(board, pVal, config.maxDepth, remainingTime)
      let path = toPath(result.move, config.boardDepth)

      if (!isLegalMove(boardNode, path, constraint, config.boardDepth)) {
        if (path.length > 0) {
          console.error('AI generated an invalid move:', path)
          tt.clear()
        }
        path = board.getWinner() === 0
          ? findLegalMove(boardNode, constraint, config.boardDepth)
          : []
      }

      self.postMessage({
        type: 'result',
        id,
        result: {
          move: path,
          score: result.score,
          depth: result.depth,
          nodes: result.nodes,
          time: performance.now() - start,
        },
      })
    } catch (error) {
      console.error('AI Search Error:', error)
      tt.clear()
      self.postMessage({
        type: 'result',
        id,
        result: {
          move: findLegalMove(boardNode, constraint, config.boardDepth),
          score: 0,
          depth: 0,
          nodes: 0,
          time: performance.now() - start,
        },
      })
    }
  } else if (msg.type === 'benchmark') {
    const { board: boardNode, player, constraint, config } = msg
    try {
      tt.clear()
      const board = BoardAdapter.toBoard(boardNode, config.boardDepth, constraint)
      const pVal = player === 'X' ? CELL_X : CELL_O

      const start = performance.now()
      const res = engine.search(board, pVal, config.maxDepth, config.maxTime)
      const elapsed = performance.now() - start
      const result = {
        default: {
          time: elapsed,
          nodes: res.nodes,
          nps: elapsed > 0 ? res.nodes / (elapsed / 1000) : 0,
          depth: res.depth,
        },
      }

      console.log('Benchmark Result:', result)
      self.postMessage({ type: 'benchmark_result', result })
    } catch (error) {
      console.error('Benchmark Error:', error)
    }
  } else if (msg.type === 'clear') {
    tt.clear()
  }
}
