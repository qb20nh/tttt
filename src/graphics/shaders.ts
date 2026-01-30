export const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = `
  varying vec2 vUv;
  
  uniform sampler2D uStateTexture;
  uniform vec2 uHover;
  uniform vec4 uConstraint;
  uniform float uTime;
  uniform float uPlayer; // 0=X (Red), 1=O (Blue/Cyan) - BUT wait. 
  // User said: "border color... to dark red and light red depending on current turn"
  // Assuming: Turn X -> Red Borders. Turn O -> Blue Borders?
  // Or "depending on current turn" means it reflects the player whose turn it is.
  // X is usually Reddish/Cyan? No O is Magenta/Cyan in this shader? 
  // C_X = (0.2, 0.9, 1.0) -> Cyan
  // C_O = (1.0, 0.2, 0.6) -> Magenta/Reddish
  
  // Existing:
  // C_3X = (0.1, 0.25, 0.55) -> Dark Blue
  // C_4X = (0.4, 0.6, 0.9) -> Light Blue
  
  // Proposed:
  // If turn is O (Magenta), use Blue/Magenta themes? 
  // If turn is X (Cyan), use Cyan/Red themes?
  
  // Let's assume User wants Red/Blue DUALITY.
  // X = Red, O = Blue? Or vice versa?
  // Let's make it:
  // ONE state: Dark Blue / Light Blue (Existing)
  // OTHER state: Dark Red / Light Red
  
  // C_3X_BLUE = vec3(0.1, 0.25, 0.55)
  // C_4X_BLUE = vec3(0.4, 0.6, 0.9)
  
  // C_3X_RED = vec3(0.55, 0.1, 0.1)
  // C_4X_RED = vec3(0.9, 0.4, 0.4)
  
  const vec3 C_BG_BLUE = vec3(0.05, 0.07, 0.12);
  const vec3 C_BG_RED = vec3(0.12, 0.05, 0.05);

  const vec3 C_1X = vec3(0.3, 0.3, 0.3);
  const vec3 C_2X = vec3(0.5, 0.5, 0.5);
  
  // Dynamic defs handled in main or ternary here? GLSL ES 1.0? 
  // Better to use mix in main.
  
  const vec3 C_3X_BLUE = vec3(0.1, 0.25, 0.55);
  const vec3 C_4X_BLUE = vec3(0.4, 0.6, 0.9);
  
  const vec3 C_3X_RED = vec3(0.55, 0.1, 0.15);
  const vec3 C_4X_RED = vec3(0.9, 0.4, 0.4);

  const vec3 C_5X = vec3(1.0, 1.0, 1.0);
  const vec3 C_X = vec3(0.2, 0.9, 1.0); 
  const vec3 C_O = vec3(1.0, 0.2, 0.6); 
  const vec3 C_GOLD = vec3(1.0, 0.8, 0.2); 
  const float BASE_GAP = 0.000625;
  const float OUTER_GAP = 5.0 * 0.000625;

  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float sdSegment( in vec2 p, in vec2 a, in vec2 b ) {
    vec2 pa = p-a, ba = b-a;
    float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length( pa - ba*h );
  }
  float sdRing(vec2 p, float r, float w) {
    return abs(length(p) - r) - w;
  }
  float drawStroke(float dist, float thickness, float px) {
    float halfWidth = thickness * 0.5;
    float visHalfWidth = max(halfWidth, px * 0.5);
    float alpha = min(1.0, thickness / px);
    return alpha * (1.0 - smoothstep(visHalfWidth - px * 0.5, visHalfWidth + px * 0.5, dist));
  }
  float calcGap(float coord, float center, float width, float px) {
    float d = abs(coord - center);
    return drawStroke(d, width, px); 
  }
  vec3 getPlayerColor(float val) {
      if (val < 0.6) return C_X;
      return C_O;
  }
  
  vec4 getWinLineCoords(int pattern) {
      float start = 0.1; float end = 0.9;
      float c0 = 5.0/6.0; float c1 = 0.5; float c2 = 1.0/6.0;
      if (pattern == 0) return vec4(start, c2, end, c2); // Bottom
      if (pattern == 1) return vec4(start, c1, end, c1);
      if (pattern == 2) return vec4(start, c0, end, c0); // Top
      if (pattern == 3) return vec4(c2, end, c2, start);
      if (pattern == 4) return vec4(c1, end, c1, start);
      if (pattern == 5) return vec4(c0, end, c0, start);
      if (pattern == 6) return vec4(start, start, end, end); // BL -> TR
      if (pattern == 7) return vec4(end, start, start, end); // BR -> TL
      return vec4(0.0);
  }

  void main() {
    vec2 gridStart = vec2(OUTER_GAP);
    vec2 gridSize = vec2(1.0 - 2.0 * OUTER_GAP);
    vec2 gridUV = (vUv - gridStart) / gridSize;
    bool inside = (vUv.x > OUTER_GAP && vUv.x < 1.0 - OUTER_GAP && 
                   vUv.y > OUTER_GAP && vUv.y < 1.0 - OUTER_GAP);

    float globalPx = fwidth(gridUV.x);
    vec2 localUV = gridUV;
    vec2 globalIdx = vec2(0.0); 
    float currentScale = 1.0;
    
    vec2 uvLevels[4]; 
    float pxLevels[4];
    float borderMasks[4]; 
    if (!inside) localUV = vec2(0.5); 

    for (int i = 0; i < 4; i++) {
        float level = 4.0 - float(i);
        float effectiveGap = (BASE_GAP * level) / gridSize.x;
        float gap = effectiveGap / currentScale;
        float localPx = globalPx / currentScale;
        
        uvLevels[i] = localUV;
        pxLevels[i] = localPx;

        float size = (1.0 - 2.0 * gap) / 3.0;
        float c1 = size + gap * 0.5;
        float c2 = 2.0 * size + gap * 1.5;
        
        float bx = max(calcGap(localUV.x, c1, gap, localPx), calcGap(localUV.x, c2, gap, localPx));
        float by = max(calcGap(localUV.y, c1, gap, localPx), calcGap(localUV.y, c2, gap, localPx));
        borderMasks[i] = max(bx, by);
        
        vec2 cellXY = vec2(0.0);
        vec2 cellOffset = vec2(0.0);
        if (localUV.x < size + gap) { cellXY.x = 0.0; cellOffset.x = 0.0; }
        else if (localUV.x < 2.0 * size + 2.0 * gap) { cellXY.x = 1.0; cellOffset.x = size + gap; }
        else { cellXY.x = 2.0; cellOffset.x = 2.0 * (size + gap); }
        if (localUV.y < size + gap) { cellXY.y = 0.0; cellOffset.y = 0.0; }
        else if (localUV.y < 2.0 * size + 2.0 * gap) { cellXY.y = 1.0; cellOffset.y = size + gap; }
        else { cellXY.y = 2.0; cellOffset.y = 2.0 * (size + gap); }
        
        localUV = (localUV - cellOffset) / size;
        currentScale *= size;
        float multiplier = pow(3.0, 3.0 - float(i));
        globalIdx += cellXY * multiplier;
    }

    vec3 color = mix(C_BG_BLUE, C_BG_RED, uPlayer);
    
    if (inside) {
        vec2 idx = globalIdx;
        float gridMask = max(max(borderMasks[0], borderMasks[1]), max(borderMasks[2], borderMasks[3]));
        float safeArea = 1.0 - gridMask;

        vec2 texUV = (idx + 0.5) / 81.0;
        vec4 state = texture2D(uStateTexture, texUV);
        
        // 1. Tint
        if (state.a > 0.05) color = mix(color, getPlayerColor(state.a), 0.05);
        if (state.b > 0.05) color = mix(color, getPlayerColor(state.b), 0.10);
        if (state.g > 0.05) color = mix(color, getPlayerColor(state.g), 0.15);
        if (state.r > 0.05) color = mix(color, getPlayerColor(state.r), 0.20);

        // 2. Inner Glow
        if (uConstraint.z > 0.0) {
             vec2 center = uConstraint.xy + uConstraint.zw * 0.5;
             vec2 halfSize = uConstraint.zw * 0.5;
             float d = sdBox(gridUV - center, halfSize); 
             if (d < 0.0) {
                 float decay = 20.0; 
                 float glowIntensity = exp(-abs(d) * decay);
                 float pulse = 0.6 + 0.4 * sin(uTime * 4.0);
                 color = mix(color, C_GOLD, glowIntensity * 0.3 * pulse * safeArea);
             }
        }
        
        // 3. Borders
        vec3 c3 = mix(C_3X_BLUE, C_3X_RED, uPlayer); 
        vec3 c4 = mix(C_4X_BLUE, C_4X_RED, uPlayer);
        
        color = mix(color, C_1X, borderMasks[3]);
        color = mix(color, C_2X, borderMasks[2]);
        color = mix(color, c3, borderMasks[1]);
        color = mix(color, c4, borderMasks[0]);
        


        // Compute "Surface Depth" - how many winners are stacking on top of this pixel
        // L1 (G), L2 (B), L3 (A)
        float wA = (state.a > 0.05) ? 1.0 : 0.0;
        float wB = (state.b > 0.05) ? 1.0 : 0.0;
        float wG = (state.g > 0.05) ? 1.0 : 0.0;

        // 5. Leaf Symbols (state.r)
        if (state.r > 0.05) {
            vec2 p = localUV * 2.0 - 1.0; 
            float dist = 0.0;
            vec3 symColor = vec3(0.0);
            float localPx = globalPx / currentScale;
            bool isX = state.r < 0.6;
            symColor = isX ? C_X : C_O;
            if (isX) { 
                float d1 = sdSegment(p, vec2(-0.6, -0.6), vec2(0.6, 0.6));
                float d2 = sdSegment(p, vec2(-0.6, 0.6), vec2(0.6, -0.6));
                dist = min(d1, d2);
            } else { 
                dist = abs(length(p) - 0.6);
            }
            // Leaf is at bottom. Layers above it are G, B, A.
            float leafDepth = wA + wB + wG; 
            // Opacity: 1.0 -> 0.8 -> 0.6 -> 0.4
            float opacity = 1.0 - 0.2 * leafDepth;
            color = mix(color, symColor, drawStroke(dist, 0.3, localPx) * safeArea * opacity);
        }
        
        // 6. Loop: Smallest (L1/G) -> Largest (L3/A)
        // k=0: L1 (G). UV=uvLevels[3].
        // k=1: L2 (B). UV=uvLevels[2].
        // k=2: L3 (A). UV=uvLevels[1].
        for (int k = 0; k < 3; k++) {
            float val = (k==0) ? state.g : (k==1) ? state.b : state.a;
            int levelIdx = 3 - k; // 3, 2, 1
            
            if (val > 0.05) {
                bool isX = val < 0.6;
                float base = isX ? 0.3 : 0.7;
                float pFloat = (val - base) / 0.02;
                int pattern = int(floor(pFloat + 0.5));
                vec3 winColor = isX ? C_X : C_O;
                
                vec2 lUV = uvLevels[levelIdx];
                float lPx = pxLevels[levelIdx];
                
                // Calculate Air Depth for this Level
                // k=0 (L1/G): Covered by B, A.
                // k=1 (L2/B): Covered by A.
                // k=2 (L3/A): Covered by None.
                float airDepth = 0.0;
                if (k == 0) airDepth = wA + wB;      // G covered by B and A
                else if (k == 1) airDepth = wA;      // B covered by A
                else airDepth = 0.0;                 // A covered by None
                
                float lvlOpacity = 1.0 - 0.1 * airDepth;

                // 1. Draw Line (Background)
                if (pattern >= 0 && pattern <= 7) {
                    vec4 coords = getWinLineCoords(pattern);
                    float dLine = sdSegment(lUV, coords.xy, coords.zw);
                    // Match Leaf Thickness: Leaf is 0.3 relative to 1/9th of this cell.
                    // So we want 0.3 / 3 = 0.1 relative to this cell.
                    float lineMask = drawStroke(dLine, 0.10, lPx);
                    // Line is also subject to depth opacity, maybe slightly less base?
                    // User said "singular 1x1 ... full opacity".
                    // Implies we want crispness. Let's use lvlOpacity directly for now.
                    // Or keep the line slightly fainter than symbol if desired, but user focused on "full opacity".
                    // Let's stick to strict hierarchy: Line is "under" symbol, does it count as another layer?
                    // User said "triple line in 3x3 has same ... as 1x1 symbol".
                    // So Line Depth = Symbol Depth? Or Line Depth = Symbol Depth + 1?
                    // "larger 3x3 symbol is drawn on top of ... triple line ... and has thicker stroke ... and higher opacity"
                    // So Line is fainter than Symbol.
                    // Let's apply an extra 0.6 factor to Line to separate it from Symbol, but scale with Air Depth.
                    color = mix(color, winColor, lineMask * lvlOpacity * 0.6);
                }
                
                // 2. Draw Symbol (Foreground)
                vec2 p = lUV * 2.0 - 1.0;
                float dSym = 0.0;
                if (isX) {
                     float d1 = sdSegment(p, vec2(-0.8, -0.8), vec2(0.8, 0.8));
                     float d2 = sdSegment(p, vec2(-0.8, 0.8), vec2(0.8, -0.8));
                     dSym = min(d1, d2);
                } else {
                     dSym = abs(length(p) - 0.8);
                }
                
                float symThickness = 0.15 + float(k) * 0.05;
                float symMask = drawStroke(dSym, symThickness, lPx);
                
                color = mix(color, winColor, symMask * lvlOpacity); 
            }
        }
        
        // 7. Hover Highlight
        if (floor(idx.x + 0.1) == floor(uHover.x + 0.1) && 
            floor(idx.y + 0.1) == floor(uHover.y + 0.1)) {
            color += vec3(0.15) * safeArea;
        }
    }
    
    // 8. Outer Border (Always on top of edges)
    float outerThick = OUTER_GAP;
    float distOuter = abs(sdBox(vUv - 0.5, vec2(0.5 - OUTER_GAP * 0.5)));
    float screenPx = fwidth(vUv.x);
    float outerMask = drawStroke(distOuter, OUTER_GAP, screenPx);
    // Hide outer border if we are in the top-level view (glow covers it)
    if (uConstraint.z > 0.8) { 
        outerMask = 0.0;
    }
    color = mix(color, C_5X, outerMask);

    // 4. Glow Border (Reordered to be on top)
    if (uConstraint.z > 0.0) {
       vec2 gridStart = vec2(OUTER_GAP);
       vec2 gridSize = vec2(1.0 - 2.0 * OUTER_GAP);
       vec2 gridUV = (vUv - gridStart) / gridSize;
       
       vec2 center = uConstraint.xy + uConstraint.zw * 0.5;
       vec2 halfSize = uConstraint.zw * 0.5;
       float d = sdBox(gridUV - center, halfSize);
       float w = uConstraint.z;
       float goldThick = BASE_GAP / gridSize.x; 
       if (w > 0.8) goldThick *= 5.0;      
       else if (w > 0.25) goldThick *= 4.0;
       else if (w > 0.08) goldThick *= 3.0; 
       else if (w > 0.02) goldThick *= 2.0; 
       float goldBorder = drawStroke(abs(d), goldThick, globalPx);
       float pulse = 0.6 + 0.4 * sin(uTime * 4.0);
       color = mix(color, C_GOLD, goldBorder * pulse);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
