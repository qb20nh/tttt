import { Search } from './ai/default/search'
import { BoardAdapter } from './ai/default/adapter'
import { generateBoard } from './logic'
import { getSearchDepth } from './constants'
import { tt } from './ai/default/transposition'
import { CELL_O } from './ai/default/constants'

// Declare the interface locally for type checking within this module,
// though the global declaration remains in main.tsx or types.d.ts ideally.
// For now, we return the function so main.tsx can attach it.

export interface BenchmarkOptions {
  depth: number
  timeout?: number
  searchDepth?: number
}

const benchmarkEngine = new Search()

export const runBenchmark = (options: BenchmarkOptions) => {
  const { depth: boardDepth, timeout, searchDepth } = options

  if (boardDepth === undefined) {
    throw new Error("Benchmark Error: 'depth' is mandatory.")
  }

  const hasTimeout = timeout !== undefined
  const hasSearchDepth = searchDepth !== undefined

  if (hasTimeout === hasSearchDepth) {
    throw new Error(
      "Benchmark Error: Exactly one of 'timeout' or 'searchDepth' must be provided."
    )
  }

  const timeMs = timeout ?? 2147483647 // Max Int if not provided
  const targetDepth = searchDepth ?? getSearchDepth(boardDepth)

  console.log(`Starting Benchmark on D=${boardDepth} board...`)
  if (hasTimeout) {
    console.log(
      `Mode: Time Limit (${timeMs}ms). Max Search Depth: ${targetDepth}`
    )
  } else console.log(`Mode: Fixed Depth (${targetDepth}). Unlimited Time.`)

  tt.clear()

  const boardNode = generateBoard(boardDepth)

  // Make one random first move so we have a non-empty board to search
  const totalCells = Math.pow(9, boardDepth)
  const randomCell = Math.floor(Math.random() * totalCells)

  // Navigate to leaf and set value
  let node = boardNode
  const path: number[] = []
  let m = randomCell
  for (let i = 0; i < boardDepth; i++) {
    path.unshift(m % 9)
    m = Math.floor(m / 9)
  }
  for (let i = 0; i < boardDepth - 1; i++) {
    node = node.children![path[i]]
  }
  node.children![path[boardDepth - 1]].value = 'X'

  // Constraint from the move
  const constraint = path.slice(1)

  const board = BoardAdapter.toBoard(boardNode, boardDepth, constraint)

  const start = performance.now()
  const result = benchmarkEngine.search(board, CELL_O, targetDepth, timeMs)
  const end = performance.now()

  const elapsed = end - start
  const nps = result.nodes > 0 ? result.nodes / (elapsed / 1000) : 0

  console.table({
    'Board Depth': boardDepth,
    'Target Search Depth': targetDepth,
    'Actual Depth Explored': result.depth,
    'Time (ms)': Math.round(elapsed),
    Nodes: result.nodes.toLocaleString(),
    NPS: Math.round(nps).toLocaleString(),
    'Best Score': result.score,
    Note: result.depth === 0 ? 'Empty board - random first move' : '',
  })

  if (result.depth === 0) {
    console.log('Empty board detected - returned random first move')
  }

  alert(
    `Benchmark Complete!\nDepth: ${result.depth}/${targetDepth}\nNPS: ${Math.round(nps).toLocaleString()}\nNodes: ${result.nodes.toLocaleString()}\nTime: ${Math.round(elapsed)}ms`
  )
}
