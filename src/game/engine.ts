import { useState } from 'react';
import type { BoardNode, Player, Winner } from './types';
import { DEPTH } from './constants';
import { checkWin, generateBoard, isFull } from './logic';

export const useGameState = () => {
    const [board, setBoard] = useState<BoardNode>(() => generateBoard(DEPTH));
    const [currentPlayer, setCurrentPlayer] = useState<Player>('X');
    const [activeConstraint, setActiveConstraint] = useState<number[]>([]);
    const [winner, setWinner] = useState<Winner>(null);

    const handleMove = (gridX: number, gridY: number) => {
        if (winner) return;

        const gameY = gridY;
        const gameX = gridX;

        const p0x = Math.floor(gameX / 27);
        const p0y = Math.floor(gameY / 27);
        const p1x = Math.floor((gameX % 27) / 9);
        const p1y = Math.floor((gameY % 27) / 9);
        const p2x = Math.floor((gameX % 9) / 3);
        const p2y = Math.floor((gameY % 9) / 3);
        const p3x = gameX % 3;
        const p3y = gameY % 3;

        const path = [
            p0y * 3 + p0x,
            p1y * 3 + p1x,
            p2y * 3 + p2x,
        ];
        const leafIndex = p3y * 3 + p3x;
        const fullPath = [...path, leafIndex];

        // Check constraint validity first to avoid invalid moves
        if (activeConstraint.length > 0) {
            for (let i = 0; i < activeConstraint.length; i++) {
                if (activeConstraint[i] !== fullPath[i]) return;
            }
        }

        const newBoard: BoardNode = JSON.parse(JSON.stringify(board));
        let current = newBoard;

        const nodes = [newBoard];
        for (const idx of path) {
            if (!current.children) break;
            current = current.children[idx];
            nodes.push(current);
        }

        const leaf = current.children ? current.children[leafIndex] : null;
        if (!leaf || leaf.value || leaf.winner) return;

        // Check if the move is actually valid (redundant check but good for safety if called directly)
        let checkNode: BoardNode = board;
        for (let i = 0; i < 4; i++) {
            const idx = fullPath[i];
            if (checkNode.winner !== null) return;
            if (i === 3) {
                if (checkNode.value !== null) return;
            } else {
                if (isFull(checkNode)) return;
                if (!checkNode.children) return;
                checkNode = checkNode.children[idx];
            }
        }

        leaf.value = currentPlayer;

        let rootWinner: Winner = null;
        let winLevel = 0;

        const newW = current.children ? checkWin(current.children) : null;
        if (newW && !current.winner) {
            current.winner = newW.winner;
            current.winPattern = newW.pattern;
            winLevel = 1;

            if (nodes.length > 2) {
                const miniNode = nodes[2];
                const miniW = miniNode.children ? checkWin(miniNode.children) : null;
                if (miniW && !miniNode.winner) {
                    miniNode.winner = miniW.winner;
                    miniNode.winPattern = miniW.pattern;
                    winLevel = 2;

                    if (nodes.length > 1) {
                        const macroNode = nodes[1];
                        const macroW = macroNode.children ? checkWin(macroNode.children) : null;
                        if (macroW && !macroNode.winner) {
                            macroNode.winner = macroW.winner;
                            macroNode.winPattern = macroW.pattern;
                            winLevel = 3;

                            const rootNode = nodes[0];
                            const rootW = rootNode.children ? checkWin(rootNode.children) : null;
                            if (rootW) {
                                rootWinner = rootW.winner;
                                rootNode.winPattern = rootW.pattern;
                            }
                        }
                    }
                }
            }
        }

        if (rootWinner) setWinner(rootWinner);

        const fullMove = [...path, leafIndex];
        let nextC: number[] = [];
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

        if (nextC.length > 0 && !isPlayable(nextC)) {
            nextC = [];
        }

        setBoard(newBoard);
        setActiveConstraint(nextC);
        setCurrentPlayer(prev => (prev === 'X' ? 'O' : 'X'));
    };

    const resetGame = () => {
        setBoard(generateBoard(DEPTH));
        setCurrentPlayer('X');
        setActiveConstraint([]);
        setWinner(null);
    };

    return {
        board,
        currentPlayer,
        activeConstraint,
        winner,
        handleMove,
        resetGame,
    };
};
