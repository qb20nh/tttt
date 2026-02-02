import { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardNode, Player, Winner, GameMode } from './types';
import { DEFAULT_DEPTH, getSearchDepth } from './constants';
import { generateBoard, isFull, canWin, isValidPath, getPathFromCoordinates, getWonDepth, getNextConstraint } from './logic';
import { loadGameState, saveGameState, clearSavedState } from './persistence';


export const useGameState = (initialDepth: number = DEFAULT_DEPTH, isPlaying: boolean = true) => {
    // Load saved state once on mount
    const [savedState] = useState(() => loadGameState());

    const [depth, setDepth] = useState(savedState?.depth || initialDepth);
    const [board, setBoard] = useState<BoardNode>(() => {
        // Only restore saved board if depth matches
        if (savedState && savedState.depth === initialDepth) {
            return savedState.board;
        }
        return generateBoard(initialDepth);
    });
    const [currentPlayer, setCurrentPlayer] = useState<Player>(() => savedState?.currentPlayer ?? 'X');
    const [activeConstraint, setActiveConstraint] = useState<number[]>(() => savedState?.activeConstraint ?? []);
    const [winner, setWinner] = useState<Winner>(() => savedState?.winner ?? null);
    const [gameMode, setGameMode] = useState<GameMode>(() => savedState?.gameMode ?? 'PvAI');
    const [isAiThinking, setIsAiThinking] = useState(false);

    if (initialDepth !== depth) {
        setDepth(initialDepth);
        setBoard(generateBoard(initialDepth));
        setCurrentPlayer('X');
        setActiveConstraint([]);
        setWinner(null);
        setIsAiThinking(false);
    }


    const workerX = useRef<Worker | null>(null);
    const workerO = useRef<Worker | null>(null);


    const latestState = useRef({ board, activeConstraint, currentPlayer, winner, gameMode, depth });
    useEffect(() => {
        latestState.current = { board, activeConstraint, currentPlayer, winner, gameMode, depth };
    }, [board, activeConstraint, currentPlayer, winner, gameMode, depth]);

    // (Moved Worker Response Handler to bottom to avoid hoisting issues)

    // Trigger AI
    const aiStartTimeRef = useRef<number>(0);
    const searchIdRef = useRef<number>(0); // Unique ID for each search request

    useEffect(() => {
        if (!isPlaying) return; // Block AI if on Home Screen
        if (winner || isAiThinking) return;

        let shouldTriggerAI = false;
        if (gameMode === 'PvAI' && currentPlayer === 'O') {
            shouldTriggerAI = true;
        } else if (gameMode === 'AIvAI') {
            shouldTriggerAI = true;
        }

        if (shouldTriggerAI) {
            // eslint-disable-next-line
            setIsAiThinking(true);
            aiStartTimeRef.current = performance.now();
            searchIdRef.current += 1; // Increment ID
            const currentSearchId = searchIdRef.current;

            const searchDepth = getSearchDepth(depth);

            let targetWorker: Worker | null = null;
            if (gameMode === 'PvAI' && currentPlayer === 'O') {
                targetWorker = workerO.current;
            } else if (gameMode === 'AIvAI') {
                targetWorker = currentPlayer === 'X' ? workerX.current : workerO.current;
            }

            targetWorker?.postMessage({
                type: 'search',
                id: currentSearchId, // Send ID
                board,
                player: currentPlayer,
                constraint: activeConstraint,
                config: {
                    maxTime: 8500,
                    maxDepth: searchDepth, // Search depth (not board depth)
                    boardDepth: depth // Actual board depth
                }
            });
        }
    }, [currentPlayer, winner, board, activeConstraint, gameMode, depth, isAiThinking, isPlaying]);


    const handleMoveInternal = useCallback((gridX: number, gridY: number, currentBoard: BoardNode, currentC: number[], currentP: Player, currentW: Winner, d: number) => {
        if (currentW) return null;

        // 1. Decompose Coordinates & Path Validity
        const pathIdxs = getPathFromCoordinates(gridX, gridY, d);

        // 2. Check Constraint & Path Validity
        if (!isValidPath(currentBoard, pathIdxs)) return null;

        if (currentC.length > 0) {
            // Constraint length is usually d-1 or less
            for (let i = 0; i < currentC.length; i++) {
                if (currentC[i] !== pathIdxs[i]) return null;
            }
        }

        // 3. Navigate & Clone
        const newBoard: BoardNode = JSON.parse(JSON.stringify(currentBoard));
        let current = newBoard;
        const nodes: BoardNode[] = [newBoard];

        for (let i = 0; i < d - 1; i++) {
            if (!current.children) return null; // Should not happen
            current = current.children[pathIdxs[i]];
            if (current.winner) return null; // Playing in won sector
            nodes.push(current);
        }

        const leafIndex = pathIdxs[d - 1];
        const leaf = current.children ? current.children[leafIndex] : null;
        if (!leaf || leaf.value || leaf.winner) return null;

        // 4. Update Leaf
        leaf.value = currentP;

        // 5. Check Wins (Bottom Up)
        const wonDepth = getWonDepth(nodes, d);

        // 6. Next Constraint
        const nextC = getNextConstraint(pathIdxs, wonDepth);

        // 7. Playability Check (if constraint target is full/won OR inside won parent)
        const isPlayable = (targetPath: number[]) => {
            if (newBoard.winner) return false;

            let node = newBoard;
            for (const idx of targetPath) {
                if (!node.children) return false;
                node = node.children[idx];
                if (node.winner) return false; // Intermediate/Target node won
            }
            return !isFull(node);
        };

        while (nextC.length > 0 && !isPlayable(nextC)) {
            nextC.pop();
        }

        let rootWinner = newBoard.winner;

        // 8. Early Stalemate Detection
        // If neither player can win the root board, it is a DRAW.
        if (!rootWinner) {
            const xCanWin = canWin(newBoard, 'X');
            const oCanWin = canWin(newBoard, 'O');
            if (!xCanWin && !oCanWin) {
                rootWinner = 'Draw';
                newBoard.winner = 'Draw'; // Mark visually?
            }
        }

        return { newBoard, rootWinner, nextC };
    }, []);

    const applyMove = useCallback((result: { newBoard: BoardNode, rootWinner: Winner, nextC: number[] }) => {
        setBoard(result.newBoard);
        setWinner(result.rootWinner);

        setActiveConstraint(prev => {
            // Prevent state update if constraint hasn't changed (Deep Compare)
            if (prev.length === result.nextC.length && prev.every((v, i) => v === result.nextC[i])) {
                return prev;
            }
            return result.nextC;
        });

        setCurrentPlayer(p => p === 'X' ? 'O' : 'X');
    }, []);

    // --- Worker Management ---
    const terminateWorkers = useCallback(() => {
        if (workerX.current) { workerX.current.terminate(); workerX.current = null; }
        if (workerO.current) { workerO.current.terminate(); workerO.current = null; }
    }, []);

    const initializeWorkers = useCallback(() => {
        terminateWorkers();

        const createWorker = () => new Worker(new URL('./ai/worker.ts', import.meta.url), { type: 'module' });
        workerX.current = createWorker();
        workerO.current = createWorker();

        const handleWorkerMessage = async (e: MessageEvent) => {
            const { type, result, id } = e.data;

            if (type === 'benchmark_result') {
                console.table(result);
                alert(`Benchmark Complete!\nDefault AI Performance:\nNPS: ${Math.round(result.default.nps).toLocaleString()}\nNodes: ${result.default.nodes}\nTime: ${Math.round(result.default.time)}ms`);
                return;
            }

            if (type === 'result') {
                if (id !== searchIdRef.current) return; // Stale

                const current = latestState.current;
                const d = current.depth;

                // Enforce minimum thinking time for UX (500ms)
                const elapsed = performance.now() - aiStartTimeRef.current;
                const minDelay = 500;
                const remaining = Math.max(0, minDelay - elapsed);

                setTimeout(() => {
                    // Double check ID again in case reset happened during timeout
                    if (id !== searchIdRef.current) return;

                    if (!result.move || result.move.length === 0) {
                        console.warn("AI returned no move.");
                        setIsAiThinking(false);
                        return;
                    }

                    let gx = 0;
                    let gy = 0;
                    for (let i = 0; i < d; i++) {
                        const idx = result.move[i];
                        if (idx === undefined) break;
                        const scale = Math.pow(3, d - 1 - i);
                        gx += (idx % 3) * scale;
                        gy += Math.floor(idx / 3) * scale;
                    }

                    let isValidAiMove = false;
                    if (current.gameMode === 'PvAI' && current.currentPlayer === 'O') isValidAiMove = true;
                    if (current.gameMode === 'AIvAI') isValidAiMove = true;

                    if (isValidAiMove) {
                        const update = handleMoveInternal(gx, gy, current.board, current.activeConstraint, current.currentPlayer, current.winner, d);
                        if (update) {
                            applyMove(update);
                        } else {
                            console.error("AI returned invalid move:", gx, gy, "Constraint:", current.activeConstraint);
                        }
                    }
                    setIsAiThinking(false);
                }, remaining);
            }
        };

        workerX.current.onmessage = handleWorkerMessage;
        workerO.current.onmessage = handleWorkerMessage;
    }, [handleMoveInternal, applyMove, terminateWorkers]);

    // Lifecycle: Init on mount, Terminate on unmount
    useEffect(() => {
        initializeWorkers();
        return () => terminateWorkers();
    }, [initializeWorkers, terminateWorkers]);

    // Lifecycle: Terminate when Game Over (Prompt Memory Release)
    useEffect(() => {
        if (winner) {
            terminateWorkers();
        }
    }, [winner, terminateWorkers]);

    const handleMove = (gridX: number, gridY: number) => {
        if (winner) return;
        if (gameMode === 'PvAI' && currentPlayer === 'O') return;
        if (isAiThinking && gameMode !== 'PvP') return;
        if (gameMode === 'AIvAI') return;

        const result = handleMoveInternal(gridX, gridY, board, activeConstraint, currentPlayer, winner, depth);
        if (!result) return;

        applyMove(result);
    };

    const resetGame = (newMode?: GameMode, newDepth?: number) => {
        clearSavedState();

        // Clear AI memory
        // Clear AI memory? Workers are fresh.
        // If we didn't terminate, we'd clear.
        // But resetGame ensures fresh workers.
        initializeWorkers();

        // Invalidate pending searches by incrementing ID
        searchIdRef.current += 1;

        const d = newDepth !== undefined ? newDepth : depth;
        // Update depth state effectively?
        if (newDepth !== undefined) setDepth(newDepth);

        setBoard(generateBoard(d));
        setCurrentPlayer('X');
        setActiveConstraint([]);
        setWinner(null);
        setIsAiThinking(false);
        if (newMode) setGameMode(newMode);
    };

    // Persistence
    useEffect(() => {
        const handleUnload = () => {
            const current = latestState.current;
            if (current.board) {
                saveGameState({
                    board: current.board,
                    currentPlayer: current.currentPlayer,
                    activeConstraint: current.activeConstraint,
                    winner: current.winner,
                    gameMode: current.gameMode,
                    depth: current.depth
                });
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') handleUnload();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return {
        board,
        currentPlayer,
        activeConstraint,
        winner,
        handleMove,
        resetGame,
        isAiThinking: isAiThinking || (gameMode === 'AIvAI' && !winner),
        gameMode,
        setGameMode,
        depth // Export depth so UI can see actual engine depth
    };
};

