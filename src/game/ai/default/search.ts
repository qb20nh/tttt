import { Board } from './board'
import { MoveGen } from './movegen'
import { CELL_EMPTY, CELL_X, CELL_O } from './constants'
import { LUT_WIN_STATUS_BASE4 } from './lookup'
import { tt } from './transposition'
import { ZOBRIST_SIDE, ZOBRIST_CONSTRAINT } from './zobrist'

// Global Move Stack (Pre-allocated)
const MOVE_STACK = new Int32Array(50000)

export class Search {
  nodesVisited = 0
  startTime = 0
  timeLimit = 1000
  abort = false

  search (
    board: Board,
    player: number,
    maxDepth: number,
    timeout: number
  ): { move: number; score: number; nodes: number; depth: number } {
    this.nodesVisited = 0
    this.startTime = performance.now()
    this.timeLimit = timeout
    this.abort = false

    // Optimization: For D>=3, return random move on empty board to save time
    if (board.depth >= 3 && this.isBoardEmpty(board)) {
      const totalCells = board.leaves.length
      const randomMove = Math.floor(Math.random() * totalCells)
      return { move: randomMove, score: 0, nodes: 0, depth: 0 }
    }

    let bestScore = -Infinity
    let bestMove = -1
    let completedDepth = 0

    // Iterative Deepening
    for (let d = 1; d <= maxDepth; d++) {
      // Guarantee completion of Depth 1 by disabling timeout abort
      const canAbort = d > 1
      const result = this.alphaBeta(
        board,
        player,
        d,
        -Infinity,
        Infinity,
        0,
        canAbort
      )

      if (this.abort) break

      bestScore = result.score
      bestMove = result.move
      completedDepth = d

      if (result.score > 90000) break
    }

    if (bestMove === -1) {
      // Fallback: Pick random move if search failed to find one (rare)
      const count = MoveGen.generate(board, MOVE_STACK, 0)
      if (count > 0) {
        // Pick random to avoid bias
        const randIdx = Math.floor(Math.random() * count)
        bestMove = MOVE_STACK[randIdx]
      }
    }

    return {
      move: bestMove,
      score: bestScore,
      nodes: this.nodesVisited,
      depth: completedDepth,
    }
  }

  // Check if board is completely empty (all leaves are CELL_EMPTY)
  private isBoardEmpty (board: Board): boolean {
    for (let i = 0; i < board.leaves.length; i++) {
      if (board.leaves[i] !== CELL_EMPTY) return false
    }
    return true
  }

  alphaBeta (
    board: Board,
    player: number,
    depth: number,
    alpha: number,
    beta: number,
    stackOffset: number,
    canAbort: boolean
  ): { score: number; move: number } {
    this.nodesVisited++
    if (canAbort && (this.nodesVisited & 65535) === 0) {
      if (performance.now() - this.startTime > this.timeLimit) {
        this.abort = true
      }
    }
    if (this.abort) return { score: 0, move: -1 }

    // TT Lookup
    let currentHash = board.hash
    if (player === CELL_O) currentHash ^= ZOBRIST_SIDE

    // Constraint Zobrist (0-730 mapped to 0-1023)
    const constraintIdx = (board.constraint + 1) & 1023
    currentHash ^= ZOBRIST_CONSTRAINT[constraintIdx]

    const ttEntry = tt.get(currentHash)
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 'exact') { return { score: ttEntry.score, move: ttEntry.bestMove } }
      if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score)
      if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score)
      if (alpha >= beta) return { score: ttEntry.score, move: ttEntry.bestMove }
    }

    const originalAlpha = alpha

    const winner = board.getWinner()
    if (winner !== 0) {
      if (winner === player) return { score: 100000 + depth, move: -1 }
      if (winner === (player === CELL_X ? CELL_O : CELL_X)) { return { score: -100000 - depth, move: -1 } }
      return { score: 0, move: -1 }
    }

    if (depth === 0) {
      return { score: board.evaluate(player), move: -1 }
    }

    const count = MoveGen.generate(board, MOVE_STACK, stackOffset)

    if (count === 0) {
      return { score: board.evaluate(player), move: -1 }
    }

    // Move Ordering: Pack (Score << 16) | Move
    // Scores: Win Local (1000), Center (50), Corner (20), Base (2000)

    if (count > 1) {
      // Precompute scores and pack
      const leafParentLayer = board.depth - 1

      for (let i = 0; i < count; i++) {
        const move = MOVE_STACK[stackOffset + i]
        const relMove = move % 9

        let score = 2000

        // 1. Check Win Local Board
        // Key of parent board
        const parentIdx = (move / 9) >>> 0
        const oldKey = board.keys[leafParentLayer][parentIdx]

        // Simulate Move on Key (Bitwise)
        // New Val = Player (1 or 2)
        const pVal = player === CELL_X ? 1 : 2
        const shift = relMove * 2

        // Verify empty? MoveGen ensures it is empty.
        const newKey = oldKey | (pVal << shift)

        const winStatus = LUT_WIN_STATUS_BASE4[newKey]

        if (winStatus === player) {
          score += 1000
        } else if (winStatus !== 0) {
          score += 100
        }

        // 2. Positional
        if (relMove === 4) score += 50
        else if (
          relMove === 0 ||
          relMove === 2 ||
          relMove === 6 ||
          relMove === 8
        ) { score += 20 }

        // Pack: Ensure score fits in 15 bits.
        MOVE_STACK[stackOffset + i] = (score << 16) | move
      }

      // Sort Descending
      const subarray = MOVE_STACK.subarray(stackOffset, stackOffset + count)
      subarray.sort((a, b) => b - a)
    }

    // Move Ordering: TT Move First
    if (ttEntry && ttEntry.bestMove !== -1) {
      for (let i = 0; i < count; i++) {
        // Check against Unpacked Move
        const packed = MOVE_STACK[stackOffset + i]
        const moveOnly = packed & 0xffff
        if (moveOnly === ttEntry.bestMove) {
          const temp = MOVE_STACK[stackOffset]
          MOVE_STACK[stackOffset] = packed
          MOVE_STACK[stackOffset + i] = temp
          break
        }
      }
    }

    let bestScore = -Infinity
    let bestMove = -1

    const opponent = player === CELL_X ? CELL_O : CELL_X
    const oldConstraint = board.constraint
    const oldLayer = board.constraintLayer

    for (let i = 0; i < count; i++) {
      // Unpack Move
      const packed = MOVE_STACK[stackOffset + i]
      const move = packed & 0xffff

      // Apply Move
      const changedLevel = board.setCell(move, player)

      // Update Constraint
      const D = board.depth
      // Ignore outermost override and keep regular relative targeting.
      const ignoreOutermostOverride = changedLevel === 1
      const targetLayer = (changedLevel === -1 || ignoreOutermostOverride)
        ? D - 1
        : changedLevel - 1

      if (targetLayer < 0) {
        board.constraint = -1
        board.constraintLayer = -1
      } else {
        const power = D - 1 - targetLayer
        let scale = 1
        for (let k = 0; k < power; k++) scale *= 9

        const parentScale = scale * 9
        const context = Math.floor(move / parentScale)
        const relMove = Math.floor(move / scale) % 9

        board.constraint = Math.floor(context / 9) * 9 + relMove
        board.constraintLayer = targetLayer
      }

      const result = this.alphaBeta(
        board,
        opponent,
        depth - 1,
        -beta,
        -alpha,
        stackOffset + count,
        canAbort
      )
      const score = -result.score

      // Revert
      board.setCell(move, CELL_EMPTY)
      board.constraint = oldConstraint
      board.constraintLayer = oldLayer

      if (this.abort) return { score: 0, move: -1 }

      if (score > bestScore) {
        bestScore = score
        bestMove = move
      }
      if (score > alpha) {
        alpha = score
        bestMove = move
      }
      if (alpha >= beta) break
    }

    // TT Store
    let flag: 'exact' | 'lower' | 'upper' = 'exact'
    if (bestScore <= originalAlpha) flag = 'upper'
    else if (bestScore >= beta) flag = 'lower'

    tt.put(currentHash, depth, bestScore, flag, bestMove)

    return { score: bestScore, move: bestMove }
  }
}
