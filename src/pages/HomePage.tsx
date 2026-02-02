import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HomeScreen } from '../components/HomeScreen';
import { IntroModal } from '../components/IntroModal';
import { loadGameState, clearSavedState } from '../game/persistence';
import type { GameMode } from '../game/types';

export const HomePage = () => {
    const navigate = useNavigate();
    const [hasSavedGame] = useState(() => !!loadGameState());
    const [showIntro, setShowIntro] = useState(false);

    const handleStartGame = (mode: GameMode, depth: number) => {
        // Clear previous state for a fresh game
        clearSavedState();

        // Navigate to play with state to initialize the engine
        navigate('/play', {
            state: {
                mode,
                depth,
                isNewGame: true
            }
        });
    };

    const handleResumeGame = () => {
        navigate('/play', {
            state: {
                isNewGame: false
            }
        });
    };

    const handleDismissIntro = () => {
        setShowIntro(false);
    };

    const handleShowIntro = () => {
        setShowIntro(true);
    };

    return (
        <div className="w-full h-screen bg-black text-white overflow-hidden relative selection:bg-cyan-500/30">
            <HomeScreen
                onStartGame={handleStartGame}
                hasSavedGame={hasSavedGame}
                onResumeGame={handleResumeGame}
                onShowIntro={handleShowIntro}
            />
            <IntroModal show={showIntro} onDismiss={handleDismissIntro} />
        </div>
    );
};
