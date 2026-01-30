import { useState, useEffect, useRef } from 'react';
import Stats from 'stats.js';
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
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const [showMenuConfirm, setShowMenuConfirm] = useState(false);
  // Persistent stats instance
  const statsRef = useRef<Stats | null>(null);

  if (!statsRef.current) {
    statsRef.current = new Stats();
    statsRef.current.showPanel(0);
  }

  const { board, currentPlayer, activeConstraint, winner, handleMove, resetGame, isAiThinking } = useGameState();
  const sceneRef = useRef<Scene3DHandle>(null);

  // Check for saved game on mount
  useEffect(() => {
    const saved = loadGameState();
    if (saved) {
      setHasSavedGame(true);
    }
  }, []);

  const handleStartGame = (mode: GameMode) => {
    resetGame(mode);
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
            onMove={handleMove}
            statsInstance={statsRef.current!}
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
            statsInstance={statsRef.current!}
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