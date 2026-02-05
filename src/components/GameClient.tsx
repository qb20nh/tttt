import { useState, useRef, useEffect, useCallback } from 'react'
import type Stats from 'stats.js'
import { useGameState } from '../game/engine'
import { Scene3D, type Scene3DHandle } from '../graphics/Scene3D'
import { GameOverlay } from './GameOverlay'
import { ConfirmationModal } from './ConfirmationModal'
import { preloadHomeScreen } from './preload'
import type { GameMode } from '../game/types'

interface GameClientProps {
  mode: GameMode
  depth: number
  isNewGame: boolean
  onNavigate?: (path: string) => void
}

export const GameClient = ({
  mode,
  depth,
  isNewGame,
  onNavigate,
}: GameClientProps) => {
  const sceneRef = useRef<Scene3DHandle>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [showMenuConfirm, setShowMenuConfirm] = useState(false)
  // Defer Scene3D mount to ensure navigation transition finishes first
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // A single frame delay is usually enough to let the browser paint the new page background
    const timer = requestAnimationFrame(() => {
      setIsReady(true)
    })
    return () => cancelAnimationFrame(timer)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number }
    type RequestIdleCallback = (
      cb: (deadline: IdleDeadline) => void,
      opts?: { timeout: number }
    ) => number
    type CancelIdleCallback = (handle: number) => void

    const win = window as Window & {
      requestIdleCallback?: RequestIdleCallback
      cancelIdleCallback?: CancelIdleCallback
    }

    const schedule = () => preloadHomeScreen()

    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => schedule(), { timeout: 2000 })
      return () => win.cancelIdleCallback?.(id)
    }

    const timeoutId = window.setTimeout(schedule, 800)
    return () => window.clearTimeout(timeoutId)
  }, [])

  // Initialize Engine
  const {
    board,
    currentPlayer,
    activeConstraint,
    winner,
    handleMove,
    resetGame,
    isAiThinking,
  } = useGameState(depth, true)

  // Track if we've initialized for this route state
  const hasInitialized = useRef(false)

  // Initialize game with route state if it's a new game
  const initializeNewGame = useCallback(() => {
    if (!hasInitialized.current && isNewGame) {
      resetGame(mode, depth)
      sceneRef.current?.resetView()
      hasInitialized.current = true
    }
  }, [isNewGame, mode, depth, resetGame])

  useEffect(() => {
    initializeNewGame()
  }, [initializeNewGame])

  useEffect(() => {
    if (import.meta.env.DEV) {
      import('stats.js').then(({ default: Stats }) => {
        const s = new Stats()
        s.showPanel(0)
        setStats(s)
      })
    }
  }, [])

  // Track intentional navigation to suppress beforeunload
  const intentionalNav = useRef(false)

  // Prevent accidental page refresh/navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if game is in progress (not won yet) AND not intentional
      if (!winner && !intentionalNav.current) {
        e.preventDefault()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [winner])

  const handleReturnToMenu = () => {
    intentionalNav.current = true
    if (onNavigate) {
      onNavigate(import.meta.env.BASE_URL)
    } else {
      // Fallback to full page navigation
      window.location.href = import.meta.env.BASE_URL
    }
  }

  return (
    <div className='w-full h-dvh bg-black text-white overflow-hidden relative selection:bg-cyan-500/30'>
      {!isReady && (
        <div className='absolute inset-0 flex items-center justify-center'>
          <div className='text-cyan-500/50 animate-pulse font-bold tracking-widest'>
            Loading...
          </div>
        </div>
      )}

      {isReady && (
        <Scene3D
          ref={sceneRef}
          board={board}
          activeConstraint={activeConstraint}
          currentPlayer={currentPlayer}
          winner={winner}
          onMove={handleMove}
          statsInstance={stats}
          depth={depth}
          initialReset={isNewGame}
        />
      )}

      <GameOverlay
        winner={winner}
        currentPlayer={currentPlayer}
        onReset={() => {
          resetGame()
          sceneRef.current?.resetView()
        }}
        onZoomIn={() => sceneRef.current?.zoomIn()}
        onZoomOut={() => sceneRef.current?.zoomOut()}
        onResetView={() => sceneRef.current?.resetView()}
        onMainMenu={() => setShowMenuConfirm(true)}
        isAiThinking={isAiThinking}
        statsInstance={stats}
      />

      <ConfirmationModal
        isOpen={showMenuConfirm}
        title='Return to Menu?'
        message='Your current game progress will be saved automatically.'
        confirmText='Main Menu'
        cancelText='Stay'
        onConfirm={handleReturnToMenu}
        onCancel={() => setShowMenuConfirm(false)}
        onHoverConfirm={preloadHomeScreen}
      />
    </div>
  )
}
