import { useState, useEffect, useRef } from 'react';
import type { BoardNode, Player, Winner, GameMode } from './types';
import { DEPTH } from './constants';
import { checkWin, generateBoard, isFull } from './logic';
import { loadGameState, saveGameState, clearSavedState } from './persistence';

export const useGameState = () => {
    // Load saved state once on mount
    const [savedState] = useState(() => loadGameState());

    const [board, setBoard] = useState<BoardNode>(() => savedState?.board ?? generateBoard(DEPTH));
    const [currentPlayer, setCurrentPlayer] = useState<Player>(() => savedState?.currentPlayer ?? 'X');
    const [activeConstraint, setActiveConstraint] = useState<number[]>(() => savedState?.activeConstraint ?? []);
    const [winner, setWinner] = useState<Winner>(() => savedState?.winner ?? null);
    const [gameMode, setGameMode] = useState<GameMode>(() => savedState?.gameMode ?? 'PvAI');
    const [isAiThinking, setIsAiThinking] = useState(false);

    const workerRef = useRef<Worker | null>(null);

    // Initialize Worker
    useEffect(() => {
        workerRef.current = new Worker(new URL('./ai/worker.ts', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (e) => {
            const { type, result } = e.data;
            if (type === 'result' && result && result.move.length > 0) {
                // Convert path to grid coordinates
                // path is numbers 0-8.
                // We need to reconstruct global x/y.
                // p0, p1, p2, p3

                let gx = 0;
                let gy = 0;

                // For depth 4:
                // Level 0 (root): p0. Scale 27.
                // Level 1: p1. Scale 9.
                // Level 2: p2. Scale 3.
                // Level 3: p3. Scale 1.

                const scales = [27, 9, 3, 1];

                for (let i = 0; i < 4; i++) {
                    const idx = result.move[i];
                    if (idx === undefined) break; // Should be length 4
                    const x = idx % 3;
                    const y = Math.floor(idx / 3);
                    gx += x * scales[i];
                    gy += y * scales[i];
                }

                if (currentPlayer === 'O') {
                    // It's AI's turn, execute the move
                    handleMove(gx, gy);
                }
                setIsAiThinking(false);
            }
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, []); // Empty dependency array? We need it to be stable, but handleMove depends on state.
    // Actually handleMove is closure-captured?
    // We should use a ref for handleMove or stable callback?
    // See below.

    // Better: use useEffect to trigger AI when player changes
    // Better: use useEffect to trigger AI when player changes
    useEffect(() => {
        if (winner || isAiThinking) return;

        let shouldTriggerAI = false;
        if (gameMode === 'PvAI' && currentPlayer === 'O') {
            shouldTriggerAI = true;
        } else if (gameMode === 'AIvAI') {
            shouldTriggerAI = true;
        }

        if (shouldTriggerAI) {
            // Trigger AI
            setIsAiThinking(true);
            workerRef.current?.postMessage({
                type: 'search',
                board,
                player: currentPlayer,
                constraint: activeConstraint,
                config: {
                    maxTime: 1000,
                    maxDepth: 6
                }
            });
        }
    }, [currentPlayer, winner, board, activeConstraint, gameMode]);




    const handleMoveInternal = (gridX: number, gridY: number, currentBoard: BoardNode, currentC: number[], currentP: Player, currentW: Winner) => {
        if (currentW) return null;

        const gameY = gridY;
        const gameX = gridX;

        // Existing logic:
        const p0x = Math.floor(gameX / 27);
        const p0y = Math.floor(gameY / 27);
        const p1x = Math.floor((gameX % 27) / 9);
        const p1y = Math.floor((gameY % 27) / 9);
        const p2x = Math.floor((gameX % 9) / 3);
        const p2y = Math.floor((gameY % 9) / 3);
        const p3x = gameX % 3;
        const p3y = gameY % 3;

        const pathIdxs = [
            p0y * 3 + p0x,
            p1y * 3 + p1x,
            p2y * 3 + p2x,
            p3y * 3 + p3x
        ];

        // Check constraint
        if (currentC.length > 0) {
            for (let i = 0; i < currentC.length; i++) {
                if (currentC[i] !== pathIdxs[i]) return null;
            }
        }

        const newBoard: BoardNode = JSON.parse(JSON.stringify(currentBoard));
        let current = newBoard;

        // Navigate
        const nodes = [newBoard];
        for (let i = 0; i < 3; i++) {
            if (!current.children) return null;
            current = current.children[pathIdxs[i]];
            if (current.winner) return null;
            nodes.push(current);
        }

        const leafIndex = pathIdxs[3];
        const leaf = current.children ? current.children[leafIndex] : null;
        if (!leaf || leaf.value || leaf.winner) return null;

        // Double check validity along path (isFull, etc)
        // ... (Skipping verbose redundant check for brevity, assuming UI prevents most)

        leaf.value = currentP;

        // Win checking
        let rootWinner: Winner = null;
        let winLevel = 0;

        // Check up the tree
        // Leaf parent (nodes[3])
        const checkWinAndPropagate = (node: BoardNode) => {
            const res = node.children ? checkWin(node.children) : null;
            if (res && !node.winner) {
                node.winner = res.winner;
                node.winPattern = res.pattern;
                return true;
            }
            return false;
        };

        // Check level 3 (leaf parent)
        if (checkWinAndPropagate(current)) winLevel = 1;

        // Check level 2
        if (winLevel === 1 && nodes.length > 2) {
            const mini = nodes[2];
            if (checkWinAndPropagate(mini)) winLevel = 2;
        }

        // Check level 1
        if (winLevel === 2 && nodes.length > 1) {
            const macro = nodes[1];
            if (checkWinAndPropagate(macro)) winLevel = 3;
        }

        // Check root
        if (winLevel === 3) {
            const root = nodes[0];
            const res = root.children ? checkWin(root.children) : null;
            if (res) {
                rootWinner = res.winner;
                root.winPattern = res.pattern;
            }
        }

        // Next constraint
        let nextC: number[] = [];
        const fullMove = pathIdxs;
        const keepDepth = 2 - winLevel;
        if (keepDepth >= 0) {
            nextC = fullMove.slice(0, keepDepth);
            nextC.push(fullMove[3 - winLevel]);
        }

        const isPlayable = (targetPath: number[]) => {
            let node = newBoard;
            for (const idx of targetPath) {
                if (!node.children) return false;
                node = node.children[idx];
            }
            return !node.winner && !isFull(node);
        };

        while (nextC.length > 0 && !isPlayable(nextC)) {
            nextC.pop();
        }

        return { newBoard, rootWinner, nextC };
    };

    const applyMove = (result: { newBoard: BoardNode, rootWinner: Winner, nextC: number[] }) => {
        setBoard(result.newBoard);
        setWinner(result.rootWinner);
        setActiveConstraint(result.nextC);
        setCurrentPlayer(p => p === 'X' ? 'O' : 'X');
    };

    const handleMove = (gridX: number, gridY: number) => {
        if (gameMode === 'PvAI' && currentPlayer === 'O') return;
        if (isAiThinking && gameMode !== 'PvP') return;
        if (gameMode === 'AIvAI') return;

        const result = handleMoveInternal(gridX, gridY, board, activeConstraint, currentPlayer, winner);
        if (!result) return;

        applyMove(result);
    };

    // Update worker listener when state changes to capture handleMove with correct closures?
    // Use a ref for handleMove? 
    const latestState = useRef({ board, activeConstraint, currentPlayer, winner, gameMode });
    useEffect(() => {
        latestState.current = { board, activeConstraint, currentPlayer, winner, gameMode };
    }, [board, activeConstraint, currentPlayer, winner, gameMode]);

    useEffect(() => {
        if (!workerRef.current) return;

        workerRef.current.onmessage = (e) => {
            const { type, result } = e.data;
            if (type === 'result') {
                // Calculate coords
                const scales = [27, 9, 3, 1];
                let gx = 0; let gy = 0;
                for (let i = 0; i < 4; i++) {
                    const idx = result.move[i];
                    if (idx === undefined) break;
                    gx += (idx % 3) * scales[i];
                    gy += Math.floor(idx / 3) * scales[i];
                }

                // Execute move using LATEST state
                const current = latestState.current;

                // Validate if it's still AI's turn or valid context
                let isValidAiMove = false;
                if (current.gameMode === 'PvAI' && current.currentPlayer === 'O') isValidAiMove = true;
                if (current.gameMode === 'AIvAI') isValidAiMove = true;

                if (isValidAiMove) {
                    // Execute move using 'current' state logic
                    const update = handleMoveInternal(gx, gy, current.board, current.activeConstraint, current.currentPlayer, current.winner);
                    if (update) {
                        applyMove(update);
                    }
                }
                setIsAiThinking(false);
            }
        };
    }, []); // Only bind once

    // Persistence on unload
    useEffect(() => {
        const handleUnload = () => {
            const current = latestState.current;
            // Don't save if game is won? User said "current board status". Assuming always save.
            // Maybe verify we have a valid state?
            if (current.board) {
                saveGameState({
                    board: current.board,
                    currentPlayer: current.currentPlayer,
                    activeConstraint: current.activeConstraint,
                    winner: current.winner,
                    gameMode: current.gameMode
                });
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        // Also save on visibility change for mobile/reliability
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                handleUnload();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    const resetGame = (newMode?: GameMode) => {
        clearSavedState();
        setBoard(generateBoard(DEPTH));
        setCurrentPlayer('X');
        setActiveConstraint([]);
        setWinner(null);
        setIsAiThinking(false);
        if (newMode) setGameMode(newMode);
    };

    return {
        board,
        currentPlayer,
        activeConstraint,
        winner,
        handleMove,
        resetGame,
        isAiThinking,
        gameMode,
        setGameMode
    };
};

