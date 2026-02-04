import { BOARD_SIZE } from '../game/constants'
import type { BoardNode, Player } from '../game/types'

const encodeWinnerValue = (winner: Player | null, pattern: number): number => {
  if (winner !== 'X' && winner !== 'O') return 0
  const base = winner === 'X' ? 0.3 : 0.7
  const safePattern = pattern >= 0 ? Math.min(pattern, 7) : 0
  return base + safePattern * 0.02
}

const encodeLeafValue = (value: Player | null): number => {
  if (!value) return 0
  return value === 'X' ? 0.3 : 0.7
}

export const fillBoardTexture = (
  board: BoardNode,
  depth: number,
  data: Float32Array | Uint8Array,
  scale: number
) => {
  data.fill(0)

  const size = Math.pow(3, depth)
  const winStack: number[] = []
  const quantize = scale !== 1

  const writePixel = (
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number
  ) => {
    const idx = (y * BOARD_SIZE + x) * 4
    if (quantize) {
      data[idx] = Math.round(r * scale)
      data[idx + 1] = Math.round(g * scale)
      data[idx + 2] = Math.round(b * scale)
      data[idx + 3] = Math.round(a * scale)
      return
    }
    data[idx] = r
    data[idx + 1] = g
    data[idx + 2] = b
    data[idx + 3] = a
  }

  const fillNode = (
    node: BoardNode,
    remainingDepth: number,
    originX: number,
    originY: number,
    nodeSize: number
  ) => {
    if (remainingDepth === 0) {
      const r = encodeLeafValue(node.value)
      const g = winStack.length >= 1 ? winStack[winStack.length - 1] : 0
      const b = winStack.length >= 2 ? winStack[winStack.length - 2] : 0
      const a = winStack.length >= 3 ? winStack[winStack.length - 3] : 0
      writePixel(originX, originY, r, g, b, a)
      return
    }

    const winValue = encodeWinnerValue(node.winner, node.winPattern)
    winStack.push(winValue)

    const childSize = nodeSize / 3
    if (node.children) {
      for (let i = 0; i < 9; i++) {
        const child = node.children[i]
        if (!child) continue
        const childX = i % 3
        const childY = Math.floor(i / 3)
        fillNode(
          child,
          remainingDepth - 1,
          originX + childX * childSize,
          originY + childY * childSize,
          childSize
        )
      }
    }

    winStack.pop()
  }

  fillNode(board, depth, 0, 0, size)
}
