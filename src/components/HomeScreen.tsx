
import { Users, Bot, MonitorPlay } from 'lucide-react';
import type { GameMode } from '../game/types';

interface HomeScreenProps {
    onStartGame: (mode: GameMode) => void;
    hasSavedGame: boolean;
    onResumeGame: () => void;
}

export const HomeScreen = ({ onStartGame, hasSavedGame, onResumeGame }: HomeScreenProps) => {
    return (
        <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-4 animate-in fade-in duration-500">
            <div className="max-w-4xl w-full space-y-12 text-center">

                {/* Header */}
                <div className="space-y-4">
                    <h1 className="text-6xl md:text-8xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent filter drop-shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                        FRACTAL TTT
                    </h1>
                    <p className="text-slate-400 text-xl md:text-2xl font-light tracking-wide">
                        Recursive Strategy. Infinite Depth.
                    </p>
                </div>

                {/* Game Modes */}
                <div className="grid md:grid-cols-3 gap-6">
                    {/* Hotseat */}
                    <button
                        onClick={() => onStartGame('PvP')}
                        className="group relative w-full h-full focus:outline-none cursor-pointer"
                    >
                        <div className="bg-slate-900/50 border border-slate-800 p-8 pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-cyan-500/50 group-hover:shadow-[0_0_30px_rgba(34,211,238,0.1)] h-full flex flex-col items-center justify-start">
                            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                            <Users className="w-12 h-12 text-cyan-400 mb-4 group-hover:scale-110 transition-transform" />
                            <h3 className="text-2xl font-bold text-white mb-2">Hotseat</h3>
                            <p className="text-slate-400 text-sm">Play with a friend on the same device</p>
                        </div>
                    </button>

                    {/* PvAI */}
                    <button
                        onClick={() => onStartGame('PvAI')}
                        className="group relative w-full h-full focus:outline-none cursor-pointer"
                    >
                        <div className="bg-slate-900/50 border border-slate-800 p-8 pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-rose-500/50 group-hover:shadow-[0_0_30px_rgba(244,63,94,0.1)] h-full flex flex-col items-center justify-start">
                            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                            <Bot className="w-12 h-12 text-rose-500 mb-4 group-hover:scale-110 transition-transform" />
                            <h3 className="text-2xl font-bold text-white mb-2">Vs A.I.</h3>
                            <p className="text-slate-400 text-sm">Challenge the recursive engine</p>
                        </div>
                    </button>

                    {/* Spectate */}
                    <button
                        onClick={() => onStartGame('AIvAI')}
                        className="group relative w-full h-full focus:outline-none cursor-pointer"
                    >
                        <div className="bg-slate-900/50 border border-slate-800 p-8 pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-purple-500/50 group-hover:shadow-[0_0_30px_rgba(168,85,247,0.1)] h-full flex flex-col items-center justify-start">
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                            <MonitorPlay className="w-12 h-12 text-purple-500 mb-4 group-hover:scale-110 transition-transform" />
                            <h3 className="text-2xl font-bold text-white mb-2">Spectate</h3>
                            <p className="text-slate-400 text-sm">Watch AI vs AI infinite battle</p>
                        </div>
                    </button>
                </div>

                {/* Resume Button */}
                {hasSavedGame && (
                    <div className="pt-8 animate-in fade-in slide-in-from-bottom-4 delay-200">
                        <button
                            onClick={onResumeGame}
                            className="bg-slate-900 border border-cyan-500/30 text-cyan-400 px-12 py-4 rounded-xl font-bold text-lg hover:bg-slate-800 hover:border-cyan-500/50 transition-all shadow-[0_0_20px_rgba(34,211,238,0.1)] active:scale-95 transform tracking-wider cursor-pointer"
                        >
                            RESUME GAME
                        </button>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="absolute bottom-8 text-slate-600 text-sm">
                v1.1 • Level 4 Recursion
            </div>
        </div>
    );
};
