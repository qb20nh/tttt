import { Users, Bot, MonitorPlay, Layers } from 'lucide-react'
import type { GameMode } from '../game/types'
import { useState, useSyncExternalStore } from 'react'
import { DEFAULT_DEPTH } from '../game/constants'
import {
  clearSavedState,
  hasSavedState,
} from '../game/persistence'
import { useShaderPrewarm } from '../graphics/prewarm'
import { IntroModal } from './IntroModal'
import { GameModeButton } from './GameModeButton'

export const HomeScreen = () => {
  // Prewarm shaders asynchronously when on Home Screen
  useShaderPrewarm()

  const [selectedDepth, setSelectedDepth] = useState(DEFAULT_DEPTH)

  // Use useSyncExternalStore to safely read localStorage on the client
  // while returning false on the server to prevent hydration mismatch.
  const hasSavedGame = useSyncExternalStore(
    () => () => { }, // No subscription needed for this simple check
    () => hasSavedState(), // Client snapshot
    () => false // Server snapshot
  )

  const [showIntro, setShowIntro] = useState(false)

  const depths = [2, 3, 4]

  const handleStartGame = (mode: GameMode, depth: number) => {
    clearSavedState()
    window.location.href = `${import.meta.env.BASE_URL}play?mode=${mode}&depth=${depth}&new=1`
  }

  const handleResumeGame = () => {
    window.location.href = `${import.meta.env.BASE_URL}play`
  }

  return (
    <>
      <div className='fixed inset-0 z-50 bg-slate-950 overflow-y-auto'>
        <div className='min-h-full w-full flex flex-col items-center justify-between p-4'>
          <div className='flex-1 flex flex-col items-center justify-center w-full max-w-4xl space-y-8 md:space-y-12 text-center my-auto'>
            {/* Header */}
            <div className='space-y-4'>
              <h1 className='text-4xl md:text-8xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent filter drop-shadow-[0_0_20px_rgba(34,211,238,0.3)]'>
                FRACTAL TTT
              </h1>
              <p className='text-slate-400 text-lg md:text-2xl font-light tracking-wide'>
                Multiscale Strategy. Nested Complexity.
              </p>
            </div>

            {/* Depth Selector */}
            <div className='flex flex-col items-center space-y-4'>
              <div className='flex items-center space-x-2 text-slate-400'>
                <Layers className='w-5 h-5' width={20} height={20} />
                <span className='uppercase tracking-widest text-sm font-bold'>
                  Recursion Depth
                </span>
              </div>
              <div className='flex space-x-4 bg-slate-900/50 p-2 rounded-xl border border-slate-800'>
                {depths.map((depth) => (
                  <button
                    key={depth}
                    onClick={() => setSelectedDepth(depth)}
                    className={`
                                        w-12 h-12 rounded-lg font-bold text-lg transition-colors duration-200 cursor-pointer
                                        ${selectedDepth === depth
                        ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(34,211,238,0.4)]'
                        : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                      }
                                    `}
                  >
                    {depth}
                  </button>
                ))}
              </div>
            </div>

            {/* Game Modes */}
            <div className='grid md:grid-cols-3 gap-6'>
              {/* Hotseat */}
              {/* Hotseat */}
              <GameModeButton
                label='Hotseat'
                description='Play with a friend on the same device'
                icon={Users}
                color='cyan'
                onClick={() => handleStartGame('PvP', selectedDepth)}
              />

              {/* PvAI */}
              <GameModeButton
                label='Vs A.I.'
                description='Challenge the strategic engine'
                icon={Bot}
                color='rose'
                onClick={() => handleStartGame('PvAI', selectedDepth)}
              />

              {/* Spectate */}
              <GameModeButton
                label='Spectate'
                description='Watch an automated duel'
                icon={MonitorPlay}
                color='purple'
                onClick={() => handleStartGame('AIvAI', selectedDepth)}
              />
            </div>

            {/* Resume Button - Fixed height container to prevent layout shift */}
            <div className='flex items-center justify-center mb-8'>
              <button
                onClick={handleResumeGame}
                disabled={!hasSavedGame}
                className={`
                  px-8 md:px-12 py-4 rounded-xl font-bold text-lg transition-colors border shadow-[0_0_20px_rgba(34,211,238,0.1)] active:scale-95 transform tracking-wider
                  ${hasSavedGame
                    ? 'bg-slate-900 border-cyan-500/30 text-cyan-400 hover:bg-slate-800 hover:border-cyan-500/50 cursor-pointer'
                    : 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed shadow-none active:scale-100'
                  }
                `}
                title={hasSavedGame ? 'Resume saved game' : 'No Saved Game'}
              >
                RESUME GAME
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className='flex flex-col items-center gap-2 shrink-0'>
            <button
              onClick={() => setShowIntro(true)}
              className='w-10 h-10 rounded-full border border-slate-700 bg-slate-900/50 text-slate-400 hover:text-white hover:border-cyan-500/50 hover:bg-slate-800 transition-colors flex items-center justify-center font-bold text-lg cursor-pointer'
              title='How to Play'
            >
              ?
            </button>
            <div className='text-slate-600 text-sm leading-none'>
              v1.2 • Adjustable Recursion
            </div>
          </div>
        </div>
      </div>
      <IntroModal show={showIntro} onDismiss={() => setShowIntro(false)} />
    </>
  )
}
