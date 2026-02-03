// Game primitives
export type Player = 'X' | 'O'
export type Winner = Player | 'Draw' | null
export type GameMode = 'PvP' | 'PvAI' | 'AIvAI'

// The fractal board structure
export interface BoardNode {
  winner: Winner
  winPattern: number
  value: Winner
  children?: BoardNode[] | null
}

// Geometric types
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
