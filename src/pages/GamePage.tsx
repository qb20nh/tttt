import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type Stats from 'stats.js';
import { useGameState } from '../game/engine';
import { Scene3D, type Scene3DHandle } from '../graphics/Scene3D';
import { GameOverlay } from '../components/GameOverlay';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { loadGameState } from '../game/persistence';
import type { GameMode } from '../game/types';

export const GamePage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const sceneRef = useRef<Scene3DHandle>(null);
    const [stats, setStats] = useState<Stats | null>(null);
    const [showMenuConfirm, setShowMenuConfirm] = useState(false);

    // Parse configuration from route state or fallback to persisted defaults
    // If resuming, we rely on loadGameState inside useGameState (which reads persistence).
    // If new game, we expect route state.
    const routeState = location.state as { mode?: GameMode, depth?: number, isNewGame?: boolean } | null;

    // We pass initialDepth to useGameState. 
    // If it's a NEW game, we use the selected depth.
    // If it's a RESUMED game, we ideally want to load the depth from persistence.
    // However, `useGameState`'s 'depth' arg is primarily for initialization.
    // Let's check persistence first if we don't have explicit route state.

    const [depth] = useState(() => {
        if (routeState?.isNewGame && routeState.depth) return routeState.depth;
        const saved = loadGameState();
        return saved?.depth || 4; // Default to 4 if nothing found
    });

    // Initialize Engine
    // We pass 'true' for isPlaying because if we are on this route, we ARE playing.
    const { board, currentPlayer, activeConstraint, winner, handleMove, resetGame, isAiThinking } = useGameState(depth, true);

    // Track if we've initialized for this route state
    const hasInitialized = useRef(false);

    // Initialize game with route state if it's a new game
    const initializeNewGame = useCallback(() => {
        if (!hasInitialized.current && routeState?.isNewGame && routeState.mode && routeState.depth) {
            resetGame(routeState.mode, routeState.depth);
            hasInitialized.current = true;
        }
    }, [routeState?.isNewGame, routeState?.mode, routeState?.depth, resetGame]);

    useEffect(() => {
        initializeNewGame();
    }, [initializeNewGame]);

    useEffect(() => {
        if (import.meta.env.DEV) {
            import('stats.js').then(({ default: Stats }) => {
                const s = new Stats();
                s.showPanel(0);
                setStats(s);
            });
        }
    }, []);

    const handleReturnToMenu = () => {
        navigate('/');
    };

    return (
        <div className="w-full h-screen bg-black text-white overflow-hidden relative selection:bg-cyan-500/30">
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
                onReset={() => {
                    // Reset current game (same settings)
                    resetGame();
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
                title="Return to Menu?"
                message="Your current game progress will be saved automatically."
                confirmText="Main Menu"
                cancelText="Stay"
                onConfirm={handleReturnToMenu}
                onCancel={() => setShowMenuConfirm(false)}
            />
        </div>
    );
};
