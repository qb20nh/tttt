import { search } from './search';
import type { BoardNode, Player } from '../types';
import { getRandomSymmetry, transformBoard, transformConstraint, inverseTransformPath } from './symmetry';

interface WorkerMessage {
    type: 'search';
    board: BoardNode;
    player: Player;
    constraint: number[];
    config: {
        maxTime: number;
        maxDepth: number;
        boardDepth: number;
    };
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const { type, board, player, constraint, config } = e.data;

    if (type === 'search') {
        try {
            // Apply Random Symmetry
            const symIdx = getRandomSymmetry();

            // console.log(`AI thinking with symmetry: ${symIdx}`);

            const transBoard = transformBoard(board, symIdx);
            const transConstraint = transformConstraint(constraint, symIdx);

            // Run search on transformed board
            const result = search(transBoard, player, transConstraint, config);

            // Inverse transform the best move
            if (result.move) {
                result.move = inverseTransformPath(result.move, symIdx);
            }

            self.postMessage({ type: 'result', result });
        } catch (error) {
            console.error("AI Search Error:", error);
            self.postMessage({ type: 'error', error: String(error) });
        }
    }
};
