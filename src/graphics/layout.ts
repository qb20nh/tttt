import type { Rect } from '../game/types';
import { BASE_GAP, OUTER_GAP, DEFAULT_DEPTH } from '../game/constants';

// --- Exact Visual Constraint Calculator ---
export const getConstraintRect = (constraint: number[], depth: number = DEFAULT_DEPTH): Rect => {
    let x = 0.0;
    let y = 0.0;
    let w = 1.0;
    let h = 1.0;

    const gridSizeScale = 1.0 - 2.0 * OUTER_GAP;

    if (constraint.length === 0) {
        const expansion = OUTER_GAP / gridSizeScale / 2.0;
        return {
            x: -expansion,
            y: -expansion,
            w: 1.0 + 2.0 * expansion,
            h: 1.0 + 2.0 * expansion
        };
    }

    for (let i = 0; i < constraint.length; i++) {
        const idx = constraint[i];
        const d = depth - i;

        const globalGap = BASE_GAP * d;
        const gapUV = globalGap / gridSizeScale;

        const subSize = (w - 2.0 * gapUV) / 3.0;

        const col = idx % 3;
        const row = Math.floor(idx / 3);

        const offsetX = col * (subSize + gapUV);
        const offsetY = row * (subSize + gapUV);

        x += offsetX;
        y += offsetY;
        w = subSize;
        h = subSize;
    }

    // Gap level for constraint border logic
    // If constraint.length == 0, gapLevel = depth+1?
    // In original code: gapLevel = 5 - constraint.length (where max depth=4)
    // So gapLevel = (depth + 1) - constraint.length.
    const gapLevel = (depth + 1) - constraint.length;
    const rawGap = BASE_GAP * gapLevel;
    const expansion = (rawGap / gridSizeScale) / 2.0;

    x -= expansion;
    y -= expansion;
    w += 2.0 * expansion;
    h += 2.0 * expansion;

    return { x, y, w, h };
};

// --- Recursive Coordinate Math (JS) ---
export const mapUVToCell = (uv: { x: number, y: number }, depth: number = DEFAULT_DEPTH): { valid: boolean, x: number, y: number } => {
    if (uv.x < OUTER_GAP || uv.x > 1.0 - OUTER_GAP ||
        uv.y < OUTER_GAP || uv.y > 1.0 - OUTER_GAP) {
        return { valid: false, x: -1, y: -1 };
    }

    let localU = (uv.x - OUTER_GAP) / (1.0 - 2.0 * OUTER_GAP);
    let localV = (uv.y - OUTER_GAP) / (1.0 - 2.0 * OUTER_GAP);

    let idxX = 0;
    let idxY = 0;
    let currentScale = 1.0;

    for (let i = 0; i < depth; i++) {
        const d = depth - i;
        const globalGap = BASE_GAP * d;
        const effectiveGap = globalGap / (1.0 - 2.0 * OUTER_GAP);
        const gap = effectiveGap / currentScale;

        if (gap >= 0.5) return { valid: false, x: -1, y: -1 };

        const size = (1.0 - 2.0 * gap) / 3.0;

        let cellX = 0; let cellY = 0;
        let offsetX = 0; let offsetY = 0;

        if (localU < size) { cellX = 0; offsetX = 0; }
        else if (localU < size + gap) { return { valid: false, x: -1, y: -1 }; }
        else if (localU < 2 * size + gap) { cellX = 1; offsetX = size + gap; }
        else if (localU < 2 * size + 2 * gap) { return { valid: false, x: -1, y: -1 }; }
        else { cellX = 2; offsetX = 2 * (size + gap); }

        if (localV < size) { cellY = 0; offsetY = 0; }
        else if (localV < size + gap) { return { valid: false, x: -1, y: -1 }; }
        else if (localV < 2 * size + gap) { cellY = 1; offsetY = size + gap; }
        else if (localV < 2 * size + 2 * gap) { return { valid: false, x: -1, y: -1 }; }
        else { cellY = 2; offsetY = 2 * (size + gap); }

        localU = (localU - offsetX) / size;
        localV = (localV - offsetY) / size;
        currentScale *= size;

        const multiplier = Math.pow(3, d - 1);
        idxX += cellX * multiplier;
        idxY += cellY * multiplier;
    }

    return { valid: true, x: idxX, y: idxY };
};
