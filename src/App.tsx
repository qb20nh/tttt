import { useState } from 'react';
import { useGameState } from './game/engine';
import { Scene3D } from './graphics/Scene3D';
import { GameOverlay } from './components/GameOverlay';
import { IntroModal } from './components/IntroModal';
import './index.css';

function App() {
  const { board, currentPlayer, activeConstraint, winner, handleMove, resetGame } = useGameState();
  const [showIntro, setShowIntro] = useState(true);

  return (
    <>
      <Scene3D
        board={board}
        activeConstraint={activeConstraint}
        onMove={handleMove}
      />

      <GameOverlay
        winner={winner}
        currentPlayer={currentPlayer}
        onReset={resetGame}
      />

      <IntroModal
        show={showIntro}
        onDismiss={() => setShowIntro(false)}
      />
    </>
  );
}

export default App;