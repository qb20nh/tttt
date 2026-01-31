import { useState, useRef, useEffect } from 'react';
import type Stats from 'stats.js';
import { useGameState } from './game/engine';
import { Scene3D, type Scene3DHandle } from './graphics/Scene3D';
import { GameOverlay } from './components/GameOverlay';
import { HomeScreen } from './components/HomeScreen';
import { ConfirmationModal } from './components/ConfirmationModal';
import { loadGameState } from './game/persistence';
import type { GameMode } from './game/types';
import './index.css';

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  // Load saved state lazily
  const [savedGame] = useState(() => loadGameState());
  const [hasSavedGame, setHasSavedGame] = useState(!!savedGame);
  const [showMenuConfirm, setShowMenuConfirm] = useState(false);
  const [depth, setDepth] = useState(savedGame?.depth || 4);
  // Persistent stats instance
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    // Lazy load stats.js only in development or if needed
    import('stats.js').then(({ default: Stats }) => {
      const s = new Stats();
      s.showPanel(0);
      setStats(s);
    });
  }, []);

  const { board, currentPlayer, activeConstraint, winner, handleMove, resetGame, isAiThinking } = useGameState(depth);
  const sceneRef = useRef<Scene3DHandle>(null);



  const handleStartGame = (mode: GameMode, selectedDepth: number) => {
    setDepth(selectedDepth);
    // We need to wait for depth to update? No, pass it explicitly if possible or rely on state update.
    // However, resetGame is from useGameState which depends on 'depth'.
    // If we call setDepth, the component re-renders, and useGameState re-runs? 
    // Actually useGameState hooks might need to react to depth change.
    resetGame(mode, selectedDepth);
    setIsPlaying(true);
    setHasSavedGame(true);
  };

  const handleResumeGame = () => {
    setIsPlaying(true);
  };

  const handleReset = () => {
    resetGame();
  };

  return (
    <div className="w-full h-screen bg-black text-white overflow-hidden relative selection:bg-cyan-500/30">

      {!isPlaying && (
        <HomeScreen
          onStartGame={handleStartGame}
          hasSavedGame={hasSavedGame}
          onResumeGame={handleResumeGame}
        />
      )}

      {isPlaying && (
        <>
          <Scene3D
            ref={sceneRef}
            board={board}
            activeConstraint={activeConstraint}
            currentPlayer={currentPlayer}
            winner={winner}
            onMove={handleMove}
            statsInstance={stats}
            depth={depth}
          />

          <GameOverlay
            winner={winner}
            currentPlayer={currentPlayer}
            onReset={handleReset}
            onZoomIn={() => sceneRef.current?.zoomIn()}
            onZoomOut={() => sceneRef.current?.zoomOut()}
            onResetView={() => sceneRef.current?.resetView()}
            onMainMenu={() => setShowMenuConfirm(true)}
            isAiThinking={isAiThinking}
            statsInstance={stats}
          />



          <ConfirmationModal
            isOpen={showMenuConfirm}
            title="Return to Menu?"
            message="Your current game progress will be saved automatically."
            confirmText="Main Menu"
            cancelText="Stay"
            onConfirm={() => {
              setShowMenuConfirm(false);
              setIsPlaying(false);
            }}
            onCancel={() => setShowMenuConfirm(false)}
          />
        </>
      )}
    </div>
  );
}

export default App;