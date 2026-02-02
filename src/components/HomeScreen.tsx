import { Users, Bot, MonitorPlay, Layers } from 'lucide-react';
import type { GameMode } from '../game/types';
import { useState } from 'react';
import { DEFAULT_DEPTH } from '../game/constants';

interface HomeScreenProps {
    onStartGame: (mode: GameMode, depth: number) => void;
    hasSavedGame: boolean;
    onResumeGame: () => void;
    onShowIntro: () => void;
}

import { useShaderPrewarm } from '../graphics/prewarm';

export const HomeScreen = ({ onStartGame, hasSavedGame, onResumeGame, onShowIntro }: HomeScreenProps) => {
    // Prewarm shaders asynchronously when on Home Screen
    useShaderPrewarm();

    const [selectedDepth, setSelectedDepth] = useState(DEFAULT_DEPTH);

    // Filter available depths (2, 3, 4)
    // We can assume MAX_DEPTH is 4.
    const depths = [2, 3, 4];

    return (
        <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto">
            <div className="min-h-full w-full flex flex-col items-center justify-between p-4 animate-in fade-in duration-500">
                <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl space-y-8 md:space-y-12 text-center py-8 my-auto">

                    {/* Header */}
                    <div className="space-y-4">
                        <h1 className="text-4xl md:text-8xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent filter drop-shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                            FRACTAL TTT
                        </h1>
                        <p className="text-slate-400 text-lg md:text-2xl font-light tracking-wide">
                            Multiscale Strategy. Nested Complexity.
                        </p>
                    </div>

                    {/* Depth Selector */}
                    <div className="flex flex-col items-center space-y-4">
                        <div className="flex items-center space-x-2 text-slate-400">
                            <Layers className="w-5 h-5" />
                            <span className="uppercase tracking-widest text-sm font-bold">Recursion Depth</span>
                        </div>
                        <div className="flex space-x-4 bg-slate-900/50 p-2 rounded-xl border border-slate-800">
                            {depths.map(depth => (
                                <button
                                    key={depth}
                                    onClick={() => setSelectedDepth(depth)}
                                    className={`
                                    w-12 h-12 rounded-lg font-bold text-lg transition-all duration-200 cursor-pointer
                                    ${selectedDepth === depth
                                            ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(34,211,238,0.4)]'
                                            : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'}
                                `}
                                >
                                    {depth}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Game Modes */}
                    <div className="grid md:grid-cols-3 gap-6">
                        {/* Hotseat */}
                        <button
                            onClick={() => onStartGame('PvP', selectedDepth)}
                            className="group relative w-full h-full focus:outline-none cursor-pointer"
                        >
                            <div className="bg-slate-900/50 border border-slate-800 p-6 md:p-8 pt-8 md:pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-cyan-500/50 group-hover:shadow-[0_0_30px_rgba(34,211,238,0.1)] h-full flex flex-col items-center justify-start">
                                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                                <Users className="w-10 h-10 md:w-12 md:h-12 text-cyan-400 mb-3 md:mb-4 group-hover:scale-110 transition-transform" />
                                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Hotseat</h3>
                                <p className="text-slate-400 text-sm">Play with a friend on the same device</p>
                            </div>
                        </button>

                        {/* PvAI */}
                        <button
                            onClick={() => onStartGame('PvAI', selectedDepth)}
                            className="group relative w-full h-full focus:outline-none cursor-pointer"
                        >
                            <div className="bg-slate-900/50 border border-slate-800 p-6 md:p-8 pt-8 md:pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-rose-500/50 group-hover:shadow-[0_0_30px_rgba(244,63,94,0.1)] h-full flex flex-col items-center justify-start">
                                <div className="absolute inset-0 bg-gradient-to-br from-rose-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                                <Bot className="w-10 h-10 md:w-12 md:h-12 text-rose-500 mb-3 md:mb-4 group-hover:scale-110 transition-transform" />
                                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Vs A.I.</h3>
                                <p className="text-slate-400 text-sm">Challenge the strategic engine</p>
                            </div>
                        </button>

                        {/* Spectate */}
                        <button
                            onClick={() => onStartGame('AIvAI', selectedDepth)}
                            className="group relative w-full h-full focus:outline-none cursor-pointer"
                        >
                            <div className="bg-slate-900/50 border border-slate-800 p-6 md:p-8 pt-8 md:pt-12 rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-slate-800 group-hover:border-purple-500/50 group-hover:shadow-[0_0_30px_rgba(168,85,247,0.1)] h-full flex flex-col items-center justify-start">
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity" />
                                <MonitorPlay className="w-10 h-10 md:w-12 md:h-12 text-purple-500 mb-3 md:mb-4 group-hover:scale-110 transition-transform" />
                                <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Spectate</h3>
                                <p className="text-slate-400 text-sm">Watch an automated duel</p>
                            </div>
                        </button>
                    </div>

                    {/* Resume Button */}
                    {hasSavedGame && (
                        <div className="pt-8 animate-in fade-in slide-in-from-bottom-4 delay-200">
                            <button
                                onClick={onResumeGame}
                                className="bg-slate-900 border border-cyan-500/30 text-cyan-400 px-8 md:px-12 py-4 rounded-xl font-bold text-lg hover:bg-slate-800 hover:border-cyan-500/50 transition-all shadow-[0_0_20px_rgba(34,211,238,0.1)] active:scale-95 transform tracking-wider cursor-pointer"
                            >
                                RESUME GAME
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex flex-col items-center gap-2 mt-8 shrink-0">
                    <button
                        onClick={onShowIntro}
                        className="w-10 h-10 rounded-full border border-slate-700 bg-slate-900/50 text-slate-400 hover:text-white hover:border-cyan-500/50 hover:bg-slate-800 transition-all flex items-center justify-center font-bold text-lg cursor-pointer"
                        title="How to Play"
                    >
                        ?
                    </button>
                    <div className="text-slate-600 text-sm leading-none">
                        v1.2 • Adjustable Recursion
                    </div>
                </div>
            </div>
        </div>
    );
};
