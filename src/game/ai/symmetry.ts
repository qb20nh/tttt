import type { BoardNode } from '../types';

// The 8 symmetries of a square (D4 group)
// Indices 0-8 of a 3x3 grid:
// 0 1 2
// 3 4 5
// 6 7 8

const SYMMETRIES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8], // Identity
    [2, 5, 8, 1, 4, 7, 0, 3, 6], // Rotate 90 CW (0->2, 1->5, 2->8...)
    [8, 7, 6, 5, 4, 3, 2, 1, 0], // Rotate 180
    [6, 3, 0, 7, 4, 1, 8, 5, 2], // Rotate 270 CW (90 CCW)
    [2, 1, 0, 5, 4, 3, 8, 7, 6], // Mirror Horizontal (Left-Right swap)
    [6, 7, 8, 3, 4, 5, 0, 1, 2], // Mirror Vertical (Top-Bottom swap)
    [0, 3, 6, 1, 4, 7, 2, 5, 8], // Major Diagonal (TopLeft-BotRight fixed)
    [8, 5, 2, 7, 4, 1, 6, 3, 0]  // Minor Diagonal (TopRight-BotLeft fixed)
];

// Precompute inverses for O(1) lookup
const INVERSE_SYMMETRIES = SYMMETRIES.map(sym => {
    const inv = new Array(9).fill(0);
    for (let i = 0; i < 9; i++) {
        inv[sym[i]] = i;
    }
    return inv;
});

export function getRandomSymmetry(): number {
    return Math.floor(Math.random() * 8);
}

// Recursively transform the board
export function transformBoard(node: BoardNode, symIdx: number): BoardNode {
    // If it's a leaf or empty, return clone
    if (!node.children) {
        return {
            winner: node.winner,
            winPattern: -1, // Pattern is invalid after transform (should be re-calculated if needed, but search uses logic.ts)
            value: node.value,
            children: null
        };
    }

    const mapping = SYMMETRIES[symIdx];
    const newChildren = new Array(9);

    // Map children: new[newPos] = transform(old[oldPos])
    // Actually: new[i] corresponds to what was at mapping[i]? No.
    // Standard permutation array P: P[i] is the new position of element i? Or element at position i?
    // Let's use standard convention: `mapping` tells us where index `i` moves TO.
    // e.g. Rot90: 0->2. So newChildren[2] = oldChildren[0].

    // WAIT. SYMMETRIES definitions above:
    // Identity: 0 is at 0.
    // Rot90: 2, 5, 8... means index 0 of the NEW board takes value from index 2 of OLD board? OR index 0 of OLD board goes to index 2?
    // Usually permutation arrays are "Value at index i is...".
    // transform([a,b,c...]) -> [a', b', c'...]
    // If Rot90 is [2, 5, 8...], it usually means result[0] = source[2].
    // Let's verify Rot90 of:
    // 0 1 2
    // 3 4 5
    // 6 7 8
    // Becomes:
    // 6 3 0
    // 7 4 1
    // 8 5 2
    // So result[0] should be 6.

    // My SYMMETRIES[1] above is [2, 5, 8 ...]. That would mean result[0] = source[2] (which is 2). That is wrong for Rot90.
    // That looks like Rot270 or Transpose?

    // Let's redefine carefully.
    // Rot90 (CW):
    // 0(0,0) -> 2(2,0)
    // 1(1,0) -> 5(2,1)
    // 2(2,0) -> 8(2,2)
    // ...
    // So source index `i` moves to target index `map[i]`.
    // result[map[i]] = source[i].

    // Let's re-verify the arrays based on "source i maps to target val".
    // 0->2, 1->5, 2->8. 
    // Identity: 0->0. Correct.
    // Rot90: 0->2, 1->5, 2->8, 3->1, 4->4, 5->7, 6->0, 7->3, 8->6.
    // array: [2, 5, 8, 1, 4, 7, 0, 3, 6]. 
    // This matches what I wrote.

    // So logic: `newChildren[mapping[i]] = transform(oldChildren[i])`.

    for (let i = 0; i < 9; i++) {
        const targetIdx = mapping[i];
        newChildren[targetIdx] = transformBoard(node.children[i], symIdx);
    }

    // Pattern also needs transform, but logic.ts will regenerate it.
    // We set it to -1 to be safe.

    return {
        winner: node.winner,
        winPattern: -1,
        value: node.value,
        children: newChildren
    };
}

export function transformPath(path: number[], symIdx: number): number[] {
    const mapping = SYMMETRIES[symIdx];
    return path.map(p => mapping[p]);
}

export function inverseTransformPath(path: number[], symIdx: number): number[] {
    const invMapping = INVERSE_SYMMETRIES[symIdx];
    return path.map(p => invMapping[p]); // new[inv[i]] = old[i]? No.
    // If forward is `y = map[x]`, inverse is `x = inv[y]`.
    // `invMapping` is defined such that `inv[map[i]] = i`.
    // So yes, just map using invMapping.
}

export function transformConstraint(constraint: number[], symIdx: number): number[] {
    return transformPath(constraint, symIdx);
}
