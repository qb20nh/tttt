import type { BoardNode, Player, Winner, GameMode } from './types'
import { checkWin } from './logic'

const KEY = 'ttt_fractal_state'

interface SavedState {
  board: BoardNode
  currentPlayer: Player
  activeConstraint: number[]
  winner: Winner
  gameMode: GameMode
  depth: number
}

// 1. Flatten Board
function flattenBoard (node: BoardNode): (Player | null)[] {
  if (!node.children) {
    const v = node.value
    return [v === 'Draw' ? null : v]
  }
  return node.children.flatMap(flattenBoard)
}

// 2. Compact (2 bits per cell)
// 00: null, 01: X, 10: O, 11: unused
function compactBoard (flat: (Player | null)[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(flat.length / 4))
  for (let i = 0; i < flat.length; i++) {
    const val = flat[i]
    let bits = 0
    if (val === 'X') {
      bits = 1 // 01
    } else if (val === 'O') bits = 2 // 10
    // else 00

    const byteIdx = Math.floor(i / 4)
    const shift = (3 - (i % 4)) * 2 // Big-endian packing within byte
    bytes[byteIdx] |= bits << shift
  }
  return bytes
}

// 3. Compress (RLE)
// Format: [count, byte]
function compressRLE (data: Uint8Array): Uint8Array {
  const result: number[] = []
  if (data.length === 0) return new Uint8Array(0)

  let currentByte = data[0]
  let count = 1

  for (let i = 1; i < data.length; i++) {
    if (data[i] === currentByte && count < 255) {
      count++
    } else {
      result.push(count)
      result.push(currentByte)
      currentByte = data[i]
      count = 1
    }
  }
  result.push(count)
  result.push(currentByte)

  return new Uint8Array(result)
}

// Helpers for Reconstruction
function uncompressRLE (data: Uint8Array, originalSize: number): Uint8Array {
  const result = new Uint8Array(originalSize)
  let writeIdx = 0
  for (let i = 0; i < data.length; i += 2) {
    const count = data[i]
    const byte = data[i + 1]
    if (writeIdx + count > originalSize) break // Safety
    result.fill(byte, writeIdx, writeIdx + count)
    writeIdx += count
  }
  return result
}

function uncompactBoard (
  packed: Uint8Array,
  totalCells: number
): (Player | null)[] {
  const flat: (Player | null)[] = []
  for (let i = 0; i < totalCells; i++) {
    const byteIdx = Math.floor(i / 4)
    const shift = (3 - (i % 4)) * 2
    const byte = packed[byteIdx]
    const bits = (byte >> shift) & 0x03

    if (bits === 1) flat.push('X')
    else if (bits === 2) flat.push('O')
    else flat.push(null)
  }
  return flat
}

function reconstructBoard (
  flat: (Player | null)[],
  depth: number
): { node: BoardNode; taken: number } {
  if (depth === 0) {
    // Leaf
    const val = flat[0]
    return {
      node: {
        winner: null,
        winPattern: -1,
        value: val,
        children: null,
      },
      taken: 1,
    }
  }

  const children: BoardNode[] = []
  let totalTaken = 0
  for (let i = 0; i < 9; i++) {
    const res = reconstructBoard(flat.slice(totalTaken), depth - 1)
    children.push(res.node)
    totalTaken += res.taken
  }

  // Since we only stored leaves, we need to re-calculate winners/values up the tree
  // Ideally the engine does this, but we need to restore state.
  // We can run a "revalidate" pass.
  const node: BoardNode = {
    winner: null,
    winPattern: -1,
    value: null,
    children,
  }

  // Check win for this node
  const winRes = checkWin(children)
  if (winRes) {
    node.winner = winRes.winner
    node.winPattern = winRes.pattern
  }

  // Logic Note: The original engine might have more complex state (like 'value' being set on non-leaves if full?)
  // In this game, usually only leaves have 'value' (X/O) and parents have 'winner'.
  // However, if a board is drawn/full, it might need handling?
  // The current `logic.ts` checkWin handles winners. `isFull` handles draws but doesn't set a property.
  // So re-running checkWin is sufficient.

  return { node, taken: totalTaken }
}

export function saveGameState (state: SavedState) {
  try {
    const flat = flattenBoard(state.board)
    const compacted = compactBoard(flat)
    const compressed = compressRLE(compacted)

    // Header format per byte:
    // 0: Player (0=X, 1=O)
    // 1: Constraint Length
    // 2..N: Constraint indices
    // Next: Depth (new)
    // Next: Game Mode
    // Next: Board Data as raw string

    // 0: Player
    // 1: Mode
    // 2: Depth
    // 3: Winner (New)
    // 4: Constraint Len

    const header: number[] = []
    header.push(state.currentPlayer === 'X' ? 0 : 1)

    // Mode
    let modeByte = 1
    if (state.gameMode === 'PvP') modeByte = 0
    else if (state.gameMode === 'AIvAI') modeByte = 2
    header.push(modeByte)

    header.push(state.depth)

    // Winner Status
    // 0=Null, 1=X, 2=O, 3=Draw
    let winByte = 0
    if (state.winner === 'X') winByte = 1
    else if (state.winner === 'O') winByte = 2
    else if (state.winner === 'Draw') winByte = 3
    header.push(winByte)

    header.push(state.activeConstraint.length)
    state.activeConstraint.forEach((c) => header.push(c))

    // ...
    let binaryString = ''
    header.forEach((b) => (binaryString += String.fromCharCode(b)))
    // ...
    for (let i = 0; i < compressed.length; i++) {
      binaryString += String.fromCharCode(compressed[i])
    }

    localStorage.setItem(KEY, binaryString)
  } catch (e) {
    console.error('Failed to save state', e)
  }
}

export function loadGameState (): SavedState | null {
  try {
    const data = localStorage.getItem(KEY)
    if (!data) return null

    let ptr = 0
    const playerByte = data.charCodeAt(ptr++)
    const currentPlayer: Player = playerByte === 0 ? 'X' : 'O'

    const modeByte = data.charCodeAt(ptr++)
    let gameMode: GameMode = 'PvAI'
    if (modeByte === 0) gameMode = 'PvP'
    else if (modeByte === 2) gameMode = 'AIvAI'

    const depth = data.charCodeAt(ptr++)
    if (depth < 2 || depth > 4) {
      // Basic validation failed, assume corrupted or old format
      return null
    }

    // Check for Winner Byte
    // How to differentiate from Constraint len?
    // Constraint len is usually 0, 1, 2...
    // Format shift is tricky without versioning.
    // We'll rely on the fact that existing saves (without winner) will likely fail structure check or we force reset.
    // Since we are developing, clearing state is acceptable.

    const winByte = data.charCodeAt(ptr++)
    let winner: Winner = null
    if (winByte === 1) winner = 'X'
    else if (winByte === 2) winner = 'O'
    else if (winByte === 3) winner = 'Draw'

    const constraintLen = data.charCodeAt(ptr++)
    const activeConstraint: number[] = []
    for (let i = 0; i < constraintLen; i++) {
      activeConstraint.push(data.charCodeAt(ptr++))
    }

    const bodyString = data.slice(ptr)
    const bodyBytes = new Uint8Array(bodyString.length)
    for (let i = 0; i < bodyString.length; i++) {
      bodyBytes[i] = bodyString.charCodeAt(i)
    }

    const TOTAL_CELLS = Math.pow(9, depth)
    const COMPACT_SIZE = Math.ceil(TOTAL_CELLS / 4)

    const compacted = uncompressRLE(bodyBytes, COMPACT_SIZE)
    const flat = uncompactBoard(compacted, TOTAL_CELLS)
    const { node } = reconstructBoard(flat, depth)

    // Apply Explicit Winner
    if (winner) {
      node.winner = winner
    } else {
      // Fallback: Check implicit winner
      const rootRes = checkWin(node.children!)
      if (rootRes) {
        node.winner = rootRes.winner
        node.winPattern = rootRes.pattern
      }
    }

    // Ensure the loaded winner matches the node winner
    const finalWinner = node.winner

    return {
      board: node,
      currentPlayer,
      activeConstraint,
      winner: finalWinner,
      gameMode,
      depth,
    }
  } catch (e) {
    console.error('Failed to load state', e)
    return null
  }
}

export function clearSavedState () {
  localStorage.removeItem(KEY)
}

export function hasSavedState (): boolean {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem(KEY)
}

// Cache for getSavedGameMeta to prevent infinite loops in useSyncExternalStore
let cachedMeta: { mode: GameMode; depth: number } | null = null
let cachedMetaString: string | null = null

export function getSavedGameMeta (): {
  mode: GameMode
  depth: number
} | null {
  try {
    const data = localStorage.getItem(KEY)
    if (!data) {
      cachedMeta = null
      cachedMetaString = null
      return null
    }

    // Return cached object if string hasn't changed
    if (data === cachedMetaString && cachedMeta) {
      return cachedMeta
    }

    let ptr = 0
    // Skip Player
    ptr++

    const modeByte = data.charCodeAt(ptr++)
    let mode: GameMode = 'PvAI'
    if (modeByte === 0) mode = 'PvP'
    else if (modeByte === 2) mode = 'AIvAI'

    const depth = data.charCodeAt(ptr++)

    // Update Cache
    cachedMeta = { mode, depth }
    cachedMetaString = data

    return cachedMeta
  } catch {
    return null
  }
}
