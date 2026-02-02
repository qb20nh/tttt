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
    // BUT we want it to match the OUTER boundary of that cell.
    // The outer boundary is one level "higher" (smaller thickness index, thicker line).
    // e.g. Len 1 (Depth 3 inside). Boundary is Level 0 (Thickness 5).
    // Len 2. Boundary is Level 1 (Thickness 4).

    // Formula: GapLevel = (Depth+2) - Len - 1 = (Depth+1) - Len?
    // Wait. Len=1. Depth=4. We want Level 0.
    // 5 - 1 = 4. Incorrect.
    // We want Level = Len - 1. (0-indexed from Top).
    // NO. The shader uses "Level" as "Depth from Top".
    // 0 = Thickest. 1 = Thinner.
    // Len 1 constraint -> Bounded by Level 0 lines.
    // Len 2 constraint -> Bounded by Level 1 lines.

    // So "GapLevel" (index into thickness array) should be Len - 1?
    // If Len=0 (Root), GapLevel? Special case.

    // Let's look at how "expansion" is used. It expands by HALF the gap stroke.
    // We want the expansion to match the boundary gap.

    let gapLevel = 0;
    if (constraint.length === 0) {
        // Root. Expand by OUTER_GAP. Handled above in special case?
        // Actually the function returns early for len=0 above? 
        // No, looking at lines 13-20, it DOES return early.
        // So we are strictly len > 0 here.
        gapLevel = 0; // fallback
    } else {
        // Len 1 -> Level 0 (Thickest) -> constraint.length - 1
        gapLevel = constraint.length - 1;
    }

    // However, the original code used logic relative to Depth?
    // "Base Gap * gapLevel".
    // If we want Thickness 5 (Level 0), we want gapLevel=5? 
    // Wait. In shader: thickness = 5.0 - float(i).
    // i=0 -> Thick=5.
    // i=1 -> Thick=4.

    // In layout.ts loop (lines 27): globalGap = BASE_GAP * d; where d = depth - i.
    // This implies "Gap Value" depends on Depth from Bottom.
    // Depth 4 (Root) -> Thickness 5?

    // Let's reconcile.
    // Top Divider (Level 0). Thickness 5.
    // Corresponds to "Gap Size" for a board of size 1.
    // In the loop: if I am at Depth 4 (Root). Sub-boards are Depth 3.
    // The divider between them is "Gap of Depth 4"?

    // Previously: gapLevel = (depth + 1) - constraint.length.
    // Len 1. Depth 4. GapLevel = 5 - 1 = 4.
    // BaseGap * 4.

    // We want to INCREASE expansion to match the PARENT divider.
    // Parent Divider is +1 "Scale".
    // So GapLevel should be +1.

    gapLevel = (depth + 2) - constraint.length;
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
