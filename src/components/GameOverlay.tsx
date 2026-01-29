import { RotateCcw } from 'lucide-react';
import type { Player, Winner } from '../game/types';

interface GameOverlayProps {
    winner: Winner;
    currentPlayer: Player;
    onReset: () => void;
}

export const GameOverlay = ({ winner, currentPlayer, onReset }: GameOverlayProps) => {
    return (
        <>
            {/* Current Turn Indicator */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <div className="bg-slate-900/80 backend-blur-md border border-slate-700 p-4 rounded-xl shadow-2xl backdrop-blur-sm">
                    <div className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Current Turn</div>
                    <div className={`text-4xl font-black ${currentPlayer === 'X' ? 'text-cyan-400' : 'text-rose-500'} drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]`}>
                        {currentPlayer}
                    </div>
                </div>
            </div>

            {/* Winner Overlay */}
            {winner && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl text-center max-w-sm mx-4 transform transition-all scale-100">
                        <h2 className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-4">Game Over</h2>
                        <div className={`text-8xl font-black mb-6 ${winner === 'X' ? 'text-cyan-400' : 'text-rose-500'} drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]`}>
                            {winner}
                        </div>
                        <div className="text-white text-2xl font-bold mb-8">Wins the Game!</div>
                        <button
                            onClick={onReset}
                            className="group flex items-center justify-center gap-2 w-full bg-white text-slate-900 px-6 py-4 rounded-xl font-bold hover:bg-slate-200 transition-all active:scale-95"
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
