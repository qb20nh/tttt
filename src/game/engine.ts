import { useState, useEffect, useRef } from 'react';
import type { BoardNode, Player, Winner, GameMode } from './types';
import { DEFAULT_DEPTH } from './constants';
import { checkWin, generateBoard, isFull, canWin } from './logic';
import { loadGameState, saveGameState, clearSavedState } from './persistence';

export const useGameState = (initialDepth: number = DEFAULT_DEPTH) => {
    // Load saved state once on mount
    const [savedState] = useState(() => loadGameState());

    const [depth, setDepth] = useState(savedState?.depth || initialDepth);
    const [board, setBoard] = useState<BoardNode>(() => {
        if (savedState && savedState.depth === (savedState.depth || DEFAULT_DEPTH)) {
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


    const workerRef = useRef<Worker | null>(null);

    // Initialize Worker
    useEffect(() => {
        workerRef.current = new Worker(new URL('./ai/worker.ts', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (e) => {
            const { type, result } = e.data;
            if (type === 'result' && result && result.move.length > 0) {
                // Convert path to grid coordinates
                // We need to use the current 'depth' to reconstruct.
                // Assuming result.move is [p0, p1, ... p(d-1)]

                // We need access to current 'depth' in closure. 
                // We use generic scales reconstruction.
                // But wait, the closure captures old depth if we don't be careful.
                // We will use 'latestState' ref pattern as before.
            }
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    const latestState = useRef({ board, activeConstraint, currentPlayer, winner, gameMode, depth });
    useEffect(() => {
        latestState.current = { board, activeConstraint, currentPlayer, winner, gameMode, depth };
    }, [board, activeConstraint, currentPlayer, winner, gameMode, depth]);

    // (Moved Worker Response Handler to bottom to avoid hoisting issues)

    // Trigger AI
    const aiStartTimeRef = useRef<number>(0);
    useEffect(() => {
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

            // Dynamic Search Depth
            // Depth 2: Small board (9 cells * 9). Global search is feasible.
            // Depth 3: Medium. 
            // Depth 4: Large.

            let searchDepth = 0;
            if (depth === 2) searchDepth = 16;
            if (depth === 3) searchDepth = 14;
            if (depth === 4) searchDepth = 12;

            workerRef.current?.postMessage({
                type: 'search',
                board,
                player: currentPlayer,
                constraint: activeConstraint,
                config: {
                    maxTime: 1000,
                    maxDepth: searchDepth, // Search depth (not board depth)
                    boardDepth: depth // Actual board depth
                }
            });
        }
    }, [currentPlayer, winner, board, activeConstraint, gameMode, depth, isAiThinking]);


    const handleMoveInternal = (gridX: number, gridY: number, currentBoard: BoardNode, currentC: number[], currentP: Player, currentW: Winner, d: number) => {
        if (currentW) return null;

        // 1. Decompose Coordinates
        const pathIdxs: number[] = [];
        let remX = gridX;
        let remY = gridY;

        for (let i = 0; i < d; i++) {
            const scale = Math.pow(3, d - 1 - i);
            const x = Math.floor(remX / scale);
            const y = Math.floor(remY / scale);
            pathIdxs.push(y * 3 + x);
            remX %= scale;
            remY %= scale;
        }

        // 2. Check Constraint
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
        // nodes has [Root, L1, L2, ... L(d-1)] (Length d)
        // We verified leaf parent winner above.

        let wonDepth = d; // Default: we just "won" (filled) the leaf level (d)

        const checkWinAndPropagate = (node: BoardNode) => {
            const res = node.children ? checkWin(node.children) : null;
            if (res && !node.winner) {
                node.winner = res.winner;
                node.winPattern = res.pattern;
                return true;
            }
            return false;
        };

        // Iterate from Leaf Parent (d-1) up to Root (0)
        // nodes[d-1] is Leaf Parent.

        for (let i = d - 1; i >= 0; i--) {
            const node = nodes[i];
            // Check if this node became won
            if (checkWinAndPropagate(node)) {
                // If node i is won, it means the effective move is at depth i
                // (e.g. if LeafParent (d-1) is won, effectively we played a move in node (d-2))
                wonDepth = i;
            } else {
                // Determine if we stop? 
                // In standard TTT, if we win a sub-board, we check parent.
                // If parent NOT won, we stop propagating win check.
                // But we still track 'wonDepth' because the constraint depends on the highest level change.
                break;
            }
        }

        // 6. Next Constraint
        // Generalized Fractal UTTT Logic:
        // We preserve the "context" (prefix) of the board we are currently playing in,
        // and append the "relative move" (suffix) to target the next sibling in that context.
        // If a board is won (wonDepth < d), the "move" is the winning board itself,
        // and the "context" shrinks to the parent scope.
        // Formula: context = path.slice(0, wonDepth - 2) + [path[wonDepth - 1]]

        let nextC: number[] = [];
        if (wonDepth > 0) {
            const contextDepth = Math.max(0, wonDepth - 2);
            const context = pathIdxs.slice(0, contextDepth);
            const targetIndex = pathIdxs[wonDepth - 1];
            nextC = [...context, targetIndex];
        }

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
    };

    const applyMove = (result: { newBoard: BoardNode, rootWinner: Winner, nextC: number[] }) => {
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
    };

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

    // Handle AI Worker Response (Placed here to access handleMoveInternal)
    useEffect(() => {
        if (!workerRef.current) return;

        workerRef.current.onmessage = async (e) => {
            const { type, result } = e.data;
            if (type === 'result') {
                const current = latestState.current;
                const d = current.depth;

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
                    }
                }
                setIsAiThinking(false);
            }
        };
    }, []);

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

