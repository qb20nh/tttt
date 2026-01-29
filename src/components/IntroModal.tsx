import { X as XIcon } from 'lucide-react';

interface IntroModalProps {
    show: boolean;
    onDismiss: () => void;
}

export const IntroModal = ({ show, onDismiss }: IntroModalProps) => {
    if (!show) return null;

    return (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-500">
            <div className="max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-8 overflow-hidden relative">
                <div className="flex justify-between items-start mb-6">
                    <h1 className="text-4xl font-black bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent">
                        FRACTAL TIC-TAC-TOE
                    </h1>
                    <button
                        onClick={onDismiss}
                        className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
                    >
                        <XIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-6 text-slate-300 leading-relaxed">
                    <p className="text-lg">
                        Welcome to <span className="text-cyan-400 font-bold">Level 4</span> recursion. The classic game reimagined in infinite depth.
                    </p>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                            <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                                The Rules
                            </h3>
                            <ul className="space-y-2 text-sm">
                                <li>• Win 3 small cells to win a sector</li>
                                <li>• Win 3 sectors to win a larger block</li>
                                <li>• Win 3 large blocks to win the game</li>
                                <li>• Your move determines where your opponent must play next</li>
                            </ul>
                        </div>

                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                            <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                Navigation
                            </h3>
                            <ul className="space-y-2 text-sm">
                                <li>• <span className="text-white font-bold">Scroll</span> to zoom in/out smoothly</li>
                                <li>• <span className="text-white font-bold">Drag</span> to pan around the infinite board</li>
                                <li>• <span className="text-white font-bold">Click</span> valid highlighted cells to play</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-800 flex justify-end">
                    <button
                        onClick={onDismiss}
                        className="bg-white text-slate-900 px-8 py-3 rounded-xl font-bold hover:bg-cyan-50 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)] active:scale-95 transform"
                    >
                        Start Game
                    </button>
                </div>
            </div>
        </div>
    );
};
