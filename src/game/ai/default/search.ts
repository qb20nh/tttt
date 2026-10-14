import { Board } from './board'
import { getOpeningMoves } from '../symmetry'
import { MoveGen } from './movegen'
import { CELL_EMPTY, CELL_X, CELL_O } from './constants'
import { LUT_WIN_STATUS_BASE4, LUT_WIN_MOVES_X, LUT_WIN_MOVES_O } from './lookup'
import { LUT_ORDER_KEY_INDEX, LUT_ORDER_RANK, computeOrderRank } from './order-lookup'
import { tt } from './transposition'
import {
  ZOBRIST_SIDE_LOW, ZOBRIST_SIDE_HIGH,
  ZOBRIST_CONSTRAINT_LOW, ZOBRIST_CONSTRAINT_HIGH,
  ZOBRIST_DEPTH_LOW, ZOBRIST_DEPTH_HIGH,
  ZOBRIST_CONSTRAINT_LAYER_LOW, ZOBRIST_CONSTRAINT_LAYER_HIGH,
} from './zobrist'

const WIN = 100000
const MATE = 90000
const NO_MOVE = 65535

export class Search {
  nodesVisited = 0
  startTime = 0
  timeLimit = 1000
  abort = false

  private moves = new Int32Array(50000)
  private killers = new Int32Array(512).fill(-1)
  private history = new Int32Array(2 * 6561)
  private openingMoves: Int32Array | null = null
  private iterationMove = -1
  private iterationScore = -Infinity
  private cachedDepth = 0

  search (
    board: Board,
    player: number,
    maxDepth: number,
    timeout: number
  ): { move: number; score: number; nodes: number; depth: number } {
    this.nodesVisited = 0
    this.startTime = performance.now()
    this.timeLimit = Math.max(0, timeout)
    this.abort = false
    this.openingMoves = null
    this.killers.fill(-1)
    // Retain ordering knowledge between turns without allowing it to dominate
    // immediate wins or blocks.
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 1
    tt.newSearch()

    const depthLimit = Math.max(1, Math.min(255, Math.floor(maxDepth)))
    this.reserve(board, depthLimit, 0)
    const winner = board.getWinner()
    if (winner !== 0) {
      return { move: -1, score: this.terminalScore(winner, player, 0), nodes: 0, depth: 0 }
    }

    // Closed sectors never reopen, so globally playable cells bound the
    // remaining game length more tightly than empty leaves in closed sectors.
    const remaining = MoveGen.countGlobal(board, depthLimit)

    this.setOpeningMoves(board)
    const count = this.generateMoves(board, 0, 0)
    if (count === 0) return { move: -1, score: 0, nodes: 0, depth: 0 }
    this.orderMoves(board, player, count, 0, 0, -1)
    let bestMove = this.moves[count - 1] & 0xffff
    let bestScore = board.evaluate(player)
    let completedDepth = 0

    for (let depth = 1; depth <= Math.min(depthLimit, remaining); depth++) {
      if (performance.now() - this.startTime >= this.timeLimit) break
      this.iterationMove = -1
      this.iterationScore = -Infinity
      let alpha = -Infinity
      let beta = Infinity
      let window = 128
      if (depth > 2 && Math.abs(bestScore) < MATE) {
        alpha = bestScore - window
        beta = bestScore + window
      }

      let score = 0
      while (!this.abort) {
        this.cachedDepth = 0
        score = this.negamax(board, player, depth, alpha, beta, 0, 0, true)
        if (this.abort) break
        if (score > alpha && score < beta) break
        // Widen only the failing side; a bound is not a completed iteration.
        window *= 4
        if (score <= alpha) alpha = window >= 8192 ? -Infinity : score - window
        else beta = window >= 8192 ? Infinity : score + window
      }

      if (this.abort) {
        if (completedDepth === 0 && this.iterationMove !== -1) {
          bestMove = this.iterationMove
          bestScore = this.iterationScore
        }
        break
      }
      if (this.iterationMove !== -1) bestMove = this.iterationMove
      bestScore = score
      completedDepth = depth
      const targetDepth = Math.min(depthLimit, remaining)
      const mateDistance = WIN - Math.abs(score)
      if (Math.abs(score) >= MATE && this.cachedDepth >= mateDistance) {
        completedDepth = Math.min(targetDepth, mateDistance)
        break
      }
      // An exact cached result already covers the requested horizon. In
      // particular, a depth covering every active cell certifies a draw.
      if (this.cachedDepth >= targetDepth) {
        completedDepth = targetDepth
        break
      }
      // A deeper cached mate can appear before the current horizon covers
      // faster alternatives. Verify its distance before ending deepening.
      if (Math.abs(score) >= MATE && depth >= WIN - Math.abs(score)) break
    }

    return { move: bestMove, score: bestScore, nodes: this.nodesVisited, depth: completedDepth }
  }

  // Kept for fixed-depth analysis and diagnostics; recursion returns scalars to
  // avoid allocating a result object at every searched node.
  alphaBeta (
    board: Board,
    player: number,
    depth: number,
    alpha: number,
    beta: number,
    stackOffset: number,
    canAbort: boolean
  ): { score: number; move: number } {
    this.reserve(board, depth, stackOffset)
    this.abort = false
    this.nodesVisited = 0
    this.iterationScore = -Infinity
    this.cachedDepth = 0
    this.iterationMove = -1
    this.setOpeningMoves(board)
    const score = this.negamax(board, player, depth, alpha, beta, stackOffset, 0, canAbort)
    return { score, move: this.iterationMove }
  }

  private setOpeningMoves (board: Board) {
    this.openingMoves = null
    if (board.constraint !== -1 || board.rootWinner !== 0) return
    for (const layer of board.keys) {
      for (const key of layer) if (key !== 0) return
    }
    for (const cell of board.leaves) if (cell !== CELL_EMPTY) return
    this.openingMoves = getOpeningMoves(board.depth)
  }

  private generateMoves (board: Board, offset: number, ply: number): number {
    if (ply === 0 && this.openingMoves !== null) {
      this.moves.set(this.openingMoves, offset)
      return this.openingMoves.length
    }
    return MoveGen.generate(board, this.moves, offset)
  }

  private reserve (board: Board, depth: number, offset: number) {
    const capacity = offset + board.leaves.length * (depth + 1)
    if (capacity > this.moves.length) this.moves = new Int32Array(capacity)
  }

  private terminalScore (winner: number, player: number, ply: number): number {
    if (winner === player) return WIN - ply
    if (winner === (player === CELL_X ? CELL_O : CELL_X)) return ply - WIN
    return 0
  }

  private orderMoves (
    board: Board,
    player: number,
    count: number,
    offset: number,
    ply: number,
    ttMove: number
  ) {
    if (count === 1) return
    const layer = board.keys[board.depth - 1]
    let lastKey = -1
    let colorKey = 0
    let rankOffset = 0
    const historyOffset = (player - 1) * 6561
    for (let i = 0; i < count; i++) {
      const move = this.moves[offset + i]
      const relative = move % 9
      const key = layer[(move / 9) >>> 0]
      if (key !== lastKey) {
        lastKey = key
        colorKey = player === CELL_X ? key : ((key & 0x15555) << 1) | ((key & 0x2aaaa) >>> 1)
        const index = LUT_ORDER_KEY_INDEX[colorKey]
        rankOffset = index === 65535 ? -1 : index * 9
      }
      const rank = rankOffset === -1 ? computeOrderRank(colorKey, relative) : LUT_ORDER_RANK[rankOffset + relative]
      let score = rank & 0x7fff
      const localWin = (rank & 0x8000) !== 0
      score += Math.min(512, this.history[historyOffset + move] >>> 3)
      if (move === this.killers[ply * 2]) score += 700
      else if (move === this.killers[ply * 2 + 1]) score += 600
      if (move === ttMove) score += 16000
      // Direct root wins precede positional and cached preferences, including
      // when a deadline permits only the ordered fallback.
      if (localWin && this.winsRoot(board, move, player)) score = 32767
      this.moves[offset + i] = (score << 16) | move
    }
    // Traverse the ascending ranks backward to avoid a second reversal pass.
    if (count > 1) this.moves.subarray(offset, offset + count).sort()
  }

  private winsRoot (board: Board, move: number, player: number): boolean {
    let nodeIdx = (move / 9) >>> 0
    for (let d = board.depth - 2; d >= 0; d--) {
      const parentIdx = (nodeIdx / 9) >>> 0
      const nextKey = board.keys[d][parentIdx] | (player << ((nodeIdx % 9) * 2))
      if (LUT_WIN_STATUS_BASE4[nextKey] !== player) return false
      nodeIdx = parentIdx
    }
    return true
  }

  private hasImmediateRootWin (board: Board, player: number): boolean {
    const wins = player === CELL_X ? LUT_WIN_MOVES_X : LUT_WIN_MOVES_O
    if (wins[board.keys[0][0]] === 0) return false
    return this.hasWinningLeaf(board, wins, 0, 0)
  }

  private hasWinningLeaf (
    board: Board,
    wins: Uint16Array,
    layer: number,
    nodeIdx: number
  ): boolean {
    if (board.getNodeStatus(layer, nodeIdx) !== 0) return false
    let mask = wins[board.keys[layer][nodeIdx]]
    if (board.constraint >= 0 && layer < board.constraintLayer) {
      const scale = board.powers[board.constraintLayer - layer - 1]
      const required = Math.floor(board.constraint / scale) % 9
      mask &= 1 << required
    }
    if (mask === 0) return false
    if (layer === board.depth - 1) return true
    while (mask !== 0) {
      const bit = mask & -mask
      const childIdx = nodeIdx * 9 + 31 - Math.clz32(bit)
      if (this.hasWinningLeaf(board, wins, layer + 1, childIdx)) return true
      mask ^= bit
    }
    return false
  }

  private playMove (board: Board, move: number, player: number) {
    const changedLevel = board.setCell(move, player)
    if (changedLevel === -1 || changedLevel === 1) {
      // The common leaf-routing case has a constant scale of one.
      board.constraint = ((move / 81) >>> 0) * 9 + move % 9
      board.constraintLayer = board.depth - 1
      board.normalizeConstraint()
      return
    }
    const targetLayer = changedLevel - 1
    if (targetLayer < 0) {
      board.constraint = -1
      board.constraintLayer = -1
    } else {
      const scale = board.powers[board.depth - 1 - targetLayer]
      const context = Math.floor(move / (scale * 9))
      const relative = Math.floor(move / scale) % 9
      board.constraint = Math.floor(context / 9) * 9 + relative
      board.constraintLayer = targetLayer
      board.normalizeConstraint()
    }
  }

  private negamax (
    board: Board,
    player: number,
    depth: number,
    alpha: number,
    beta: number,
    offset: number,
    ply: number,
    canAbort: boolean
  ): number {
    this.nodesVisited++
    if (canAbort && ((this.nodesVisited & 255) === 0 || ply === 0)) {
      if (performance.now() - this.startTime >= this.timeLimit) this.abort = true
    }
    if (this.abort) return 0

    const winner = board.getWinner()
    if (winner !== 0) return this.terminalScore(winner, player, ply)
    if (depth === 0) {
      // A legal win on the next move reaches the exact theoretical ceiling;
      // no other reply or continuation can improve this position's value.
      return this.hasImmediateRootWin(board, player)
        ? WIN - ply - 1
        : board.evaluate(player)
    }

    const constraint = (board.constraint + 1) & 1023
    const layer = board.constraintLayer + 1
    let hashLow = board.hashLow ^ ZOBRIST_DEPTH_LOW[board.depth] ^
      ZOBRIST_CONSTRAINT_LOW[constraint] ^ ZOBRIST_CONSTRAINT_LAYER_LOW[layer]
    let hashHigh = board.hashHigh ^ ZOBRIST_DEPTH_HIGH[board.depth] ^
      ZOBRIST_CONSTRAINT_HIGH[constraint] ^ ZOBRIST_CONSTRAINT_LAYER_HIGH[layer]
    if (player === CELL_O) {
      hashLow ^= ZOBRIST_SIDE_LOW
      hashHigh ^= ZOBRIST_SIDE_HIGH
    }

    const originalAlpha = alpha
    const originalBeta = beta
    const entry = tt.getIndexParts(hashLow, hashHigh)
    let ttMove = -1
    if (entry !== -1) {
      const packed = tt.values[entry * 2 + 1]
      const rawMove = (packed >>> 10) & 0xffff
      ttMove = rawMove === NO_MOVE ? -1 : rawMove
      const storedDepth = (packed >>> 2) & 0xff
      if (storedDepth >= depth) {
        let score = tt.values[entry * 2]
        if (score >= MATE) score -= ply
        else if (score <= -MATE) score += ply
        const flag = packed & 3
        if (flag === 0 || (flag === 1 && score >= beta) || (flag === 2 && score <= alpha)) {
          if (ply === 0) {
            this.iterationMove = ttMove
            this.iterationScore = score
            this.cachedDepth = flag === 0 ? storedDepth : 0
          }
          return score
        }
      }
    }

    const count = this.generateMoves(board, offset, ply)
    if (count === 0) return 0
    this.orderMoves(board, player, count, offset, ply, ttMove)

    const opponent = player === CELL_X ? CELL_O : CELL_X
    const oldConstraint = board.constraint
    const oldLayer = board.constraintLayer
    let bestScore = -Infinity
    let bestMove = -1
    for (let i = count - 1; i >= 0; i--) {
      const move = this.moves[offset + i] & 0xffff
      this.playMove(board, move, player)

      let score: number
      if (i === count - 1) {
        score = -this.negamax(board, opponent, depth - 1, -beta, -alpha, offset + count, ply + 1, canAbort)
      } else {
        score = -this.negamax(board, opponent, depth - 1, -alpha - 1, -alpha, offset + count, ply + 1, canAbort)
        if (!this.abort && score > alpha && score < beta) {
          score = -this.negamax(board, opponent, depth - 1, -beta, -alpha, offset + count, ply + 1, canAbort)
        }
      }
      board.setCell(move, CELL_EMPTY)
      board.constraint = oldConstraint
      board.constraintLayer = oldLayer
      if (this.abort) return 0

      if (score > bestScore) {
        bestScore = score
        bestMove = move
        if (ply === 0) {
          this.iterationMove = move
          this.iterationScore = score
        }
      }
      if (score > alpha) alpha = score
      if (alpha >= beta) {
        if (this.killers[ply * 2] !== move) {
          this.killers[ply * 2 + 1] = this.killers[ply * 2]
          this.killers[ply * 2] = move
        }
        const historyIndex = (player - 1) * 6561 + move
        this.history[historyIndex] = Math.min(4096, this.history[historyIndex] + depth * depth)
        break
      }
      // A nonterminal position cannot improve on winning with the next move.
      if (bestScore === WIN - ply - 1) break
      // A wide root on D4 must also observe deadlines between moves.
      if (canAbort && ply === 0 && performance.now() - this.startTime >= this.timeLimit) {
        this.abort = true
        return 0
      }
    }

    const flag = bestScore <= originalAlpha ? 'upper' : bestScore >= originalBeta ? 'lower' : 'exact'
    let storedScore = bestScore
    if (storedScore >= MATE) storedScore += ply
    else if (storedScore <= -MATE) storedScore -= ply
    tt.putParts(hashLow, hashHigh, depth, storedScore, flag, bestMove)
    return bestScore
  }
}
