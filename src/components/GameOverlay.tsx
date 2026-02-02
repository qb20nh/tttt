import { RotateCcw, Home, Plus, Minus, ArrowLeft, X, Circle, Loader2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type Stats from 'stats.js';
import type { Player, Winner } from '../game/types';
import { ConfirmationModal } from './ConfirmationModal';

interface GameOverlayProps {
    winner: Winner;
    currentPlayer: Player;
    onReset: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResetView: () => void;
    onMainMenu: () => void;
    isAiThinking: boolean;
    statsInstance: Stats | null;
}

export const GameOverlay = ({
    winner,
    currentPlayer,
    onReset,
    onZoomIn,
    onZoomOut,
    onResetView,
    onMainMenu,
    isAiThinking,
    statsInstance
}: GameOverlayProps) => {
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const statsContainerRef = useRef<HTMLDivElement>(null);

    // Reset dismissed state when winner changes
    useEffect(() => {
        if (winner) {
            setDismissed(false);
        }
    }, [winner]);

    // Mount Stats.js
    useEffect(() => {
        if (statsInstance && statsContainerRef.current) {
            const dom = statsInstance.dom;

            // Override default fixed positioning and layout
            // eslint-disable-next-line
            dom.style.position = 'relative';
            dom.style.top = 'auto';
            dom.style.left = 'auto';
            dom.style.zIndex = 'auto';
            dom.style.display = 'flex';
            dom.style.gap = '0px';
            dom.style.pointerEvents = 'none';

            Array.from(dom.children).forEach((child, index) => {
                const el = child as HTMLElement;
                if (index <= 1) { // Show FPS (0) and MS (1)
                    el.style.display = 'block';
                } else {
                    el.style.display = 'none';
                }
            });

            statsContainerRef.current.innerHTML = '';
            statsContainerRef.current.appendChild(dom);
        }
    }, [statsInstance]);

    const handleConfirmReset = () => {
        onReset();
        setShowResetConfirm(false);
    };

    return (
        <>
            {/* Top Left: Main Menu */}
            <div className="absolute top-4 left-4 z-10">
                <button
                    onClick={onMainMenu}
                    className="bg-slate-900/90 border border-slate-700 p-3 rounded-xl shadow-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all active:scale-95 group cursor-pointer"
                    title="Main Menu"
                >
                    <ArrowLeft className="w-6 h-6 group-hover:scale-110 group-hover:-translate-x-1 transition-transform" />
                </button>
            </div>

            {/* Top Center: Performance Metrics (Stats.js) */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                <div ref={statsContainerRef} />
            </div>

            {/* Top Right: Reset Game */}
            <div className="absolute top-4 right-4 z-10">
                <button
                    onClick={() => setShowResetConfirm(true)}
                    className="bg-slate-900/90 border border-slate-700 p-3 rounded-xl shadow-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all active:scale-95 group cursor-pointer"
                    title="Reset Game"
                >
                    <RotateCcw className="w-6 h-6 group-hover:-rotate-180 transition-transform duration-500" />
                </button>
            </div>

            {/* Bottom Left: Current Turn & AI Indicator */}
            <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
                <div className="bg-slate-900/90 border border-slate-700 p-4 rounded-xl shadow-2xl transition-all duration-300 ease-out">
                    <div className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">Current Turn</div>
                    <div className="flex items-center gap-4">
                        {/* Player Shape Icon */}
                        <div className="w-12 h-12 flex items-center justify-center">
                            {currentPlayer === 'X' ? (
                                <X className="w-10 h-10 text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" strokeWidth={3} />
                            ) : (
                                <Circle className="w-10 h-10 text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" strokeWidth={3} />
                            )}
                        </div>

                        {/* Integrated AI Spinner */}
                        <div className={`overflow-hidden transition-all duration-300 ease-out ${isAiThinking ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0'}`}>
                            <div className="flex items-center gap-2 border-l border-slate-700 pl-4 whitespace-nowrap">
                                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                                <span className="text-cyan-400 text-xs font-bold uppercase tracking-widest">AI Thinking</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Right: Zoom Controls */}
            <div className="absolute bottom-4 right-4 z-10">
                <div className="flex bg-slate-900/90 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
                    <button
                        onClick={onZoomOut}
                        className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors active:bg-slate-700 cursor-pointer"
                        title="Zoom Out"
                    >
                        <Minus className="w-5 h-5" />
                    </button>
                    <div className="w-px bg-slate-700" />
                    <button
                        onClick={onResetView}
                        className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors active:bg-slate-700 cursor-pointer"
                        title="Reset View"
                    >
                        <Home className="w-5 h-5" />
                    </button>
                    <div className="w-px bg-slate-700" />
                    <button
                        onClick={onZoomIn}
                        className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors active:bg-slate-700 cursor-pointer"
                        title="Zoom In"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <ConfirmationModal
                isOpen={showResetConfirm}
                title="Reset Game?"
                message="Are you sure you want to reset the game? All progress will be lost."
                confirmText="Reset Game"
                onConfirm={handleConfirmReset}
                onCancel={() => setShowResetConfirm(false)}
            />

            {/* Winner Overlay */}
            {winner && !dismissed && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 animate-in fade-in duration-300">
                    <div className="relative bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl text-center max-w-sm mx-4 transform transition-all scale-100">
                        {/* Dismiss Button */}
                        <button
                            onClick={() => setDismissed(true)}
                            className="absolute top-2 right-2 p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Dismiss"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <h2 className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-4">Game Over</h2>

                        {winner === 'Draw' ? (
                            <>
                                <div className="text-6xl font-black mb-6 text-slate-200 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                                    DRAW
                                </div>
                                <div className="text-white text-xl font-bold mb-8">Stalemate Reached</div>
                            </>
                        ) : (
                            <>
                                <div className={`text-8xl font-black mb-6 ${winner === 'X' ? 'text-cyan-400' : 'text-rose-500'} drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]`}>
                                    {winner}
                                </div>
                                <div className="text-white text-2xl font-bold mb-8">Wins the Game!</div>
                            </>
                        )}
                        <button
                            onClick={onReset}
                            className="group flex items-center justify-center gap-2 w-full bg-white text-slate-900 px-6 py-4 rounded-xl font-bold hover:bg-slate-200 transition-all active:scale-95 cursor-pointer"
                        >
                            <RotateCcw className="w-5 h-5 group-hover:-rotate-180 transition-transform duration-500" />
                            Play Again
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
