import { useState, useRef, useEffect, useCallback } from 'react'
import type Stats from 'stats.js'
import { useGameState } from '../game/engine'
import { Scene3D, type Scene3DHandle } from '../graphics/Scene3D'
import { GameOverlay } from './GameOverlay'
import { ConfirmationModal } from './ConfirmationModal'
import { loadGameState } from '../game/persistence'
import type { GameMode } from '../game/types'

export const GameClient = () => {
  const sceneRef = useRef<Scene3DHandle>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [showMenuConfirm, setShowMenuConfirm] = useState(false)

  // Parse configuration from URL search params
  const [config] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = (params.get('mode') as GameMode) || 'PvAI'
    const depthParam = params.get('depth')
    const isNewGame = params.get('new') === '1'

    let depth = 4
    if (isNewGame && depthParam) {
      depth = parseInt(depthParam, 10)
    } else {
      const saved = loadGameState()
      depth = saved?.depth || 4
    }

    return { mode, depth, isNewGame }
  })

  // Initialize Engine
  const {
    board,
    currentPlayer,
    activeConstraint,
    winner,
    handleMove,
    resetGame,
    isAiThinking,
  } = useGameState(config.depth, true)

  // Track if we've initialized for this route state
  const hasInitialized = useRef(false)

  // Initialize game with route state if it's a new game
  const initializeNewGame = useCallback(() => {
    if (!hasInitialized.current && config.isNewGame) {
      resetGame(config.mode, config.depth)
      sceneRef.current?.resetView()
      hasInitialized.current = true
    }
  }, [config.isNewGame, config.mode, config.depth, resetGame])

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

  // Prevent accidental page refresh/navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if game is in progress (not won yet)
      if (!winner) {
        e.preventDefault()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [winner])

  const handleReturnToMenu = () => {
    // Use native navigation for Astro SSG
    window.location.href = import.meta.env.BASE_URL
  }

  return (
    <div className='w-full h-screen bg-black text-white overflow-hidden relative selection:bg-cyan-500/30'>
      <Scene3D
        ref={sceneRef}
        board={board}
        activeConstraint={activeConstraint}
        currentPlayer={currentPlayer}
        winner={winner}
        onMove={handleMove}
        statsInstance={stats}
        depth={config.depth}
        initialReset={config.isNewGame}
      />

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
      />
    </div>
  )
}
