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
  uniform ivec2 uHover;
  uniform vec4 uConstraint;
  uniform float uTime;
  uniform float uPlayer; 
  uniform int uDepth;
  uniform int uConstraintLevel;
  uniform int uGameOver; // 0 or 1

  // Colors
  const vec3 C_BG_BLUE = vec3(0.05, 0.07, 0.12);
  const vec3 C_BG_RED = vec3(0.12, 0.05, 0.05);
  const vec3 C_BG_NEUTRAL = vec3(0.02, 0.02, 0.02);

  const vec3 C_1X = vec3(0.3, 0.3, 0.3);
  const vec3 C_2X = vec3(0.5, 0.5, 0.5);
  
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
    
    // We can assume max depth 4 for array sizing, but use uDepth for loops.
    vec2 uvLevels[4]; 
    float pxLevels[4];
    float borderMasks[4]; 
    
    // Initialize defaults
    for(int i=0; i<4; i++) {
        uvLevels[i] = vec2(0.0);
        pxLevels[i] = 1.0;
        borderMasks[i] = 0.0;
    }

    vec2 globalIdx = vec2(0.0); 
    float currentScale = 1.0;
    
    if (!inside) localUV = vec2(0.5); 

    // Loop up to uDepth
    for (int i = 0; i < 4; i++) {
        if (i >= uDepth) break;

        // User Requirement: Border thickness 5 (outermost), 4, 3, ...
        // i=0 is outermost divider (Largest).
        float thickness = 5.0 - float(i); 
        float effectiveGap = (BASE_GAP * thickness) / gridSize.x;
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
        float multiplier = pow(3.0, float(uDepth) - 1.0 - float(i));
        globalIdx += cellXY * multiplier;
    }

    vec3 baseColor = mix(C_BG_BLUE, C_BG_RED, uPlayer);
    if (uGameOver > 0) baseColor = C_BG_NEUTRAL;
    
    vec3 color = baseColor;
    
    if (inside) {
        vec2 idx = globalIdx;
        
        // Calculate grid mask based on uDepth
        float gridMask = 0.0;
        for(int i=0; i<4; i++) {
            if (i < uDepth) gridMask = max(gridMask, borderMasks[i]);
        }
        
        float safeArea = 1.0 - gridMask;

        // Texture coordinate mapping
        // The texture is always BOARD_SIZE x BOARD_SIZE (81x81).
        // While we may only use a subset of it for smaller depths (e.g. 9x9 for depth 2),
        // we map the global index (0..8) to the corresponding pixels (0..8) in the 81x81 image.
        // Thus, we must divide by the full texture size (81.0), not the dynamic maxDim.
        
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
        
        // Loop from Top-Down (i=0 is largest divider)
        for(int i=0; i<4; i++) {
            if (i >= uDepth) break;
            
            vec3 borderColor = C_1X; // Default (Deepest levels)
            
            // "outermost is white first largest inner border is light colored"
            // "second largest is dark colored"
            // "next light gray"
            // "next dark gray"
            
            // i=0 (Top Divider): Light Colored (c4)
            if (i == 0) borderColor = c4;
            // i=1: Dark Colored (c3)
            else if (i == 1) borderColor = c3;
            // i=2: Light Gray (C_2X)
            else if (i == 2) borderColor = C_2X;
            // i=3 (or deeper): Dark Gray (C_1X)
            else borderColor = C_1X;
            
            color = mix(color, borderColor, borderMasks[i]);
        }

        // Compute "Surface Depth" weights
        // Corresponding to k=0,1,2 in loop below
        // k maps to Depth Level from Bottom (1, 2, 3...)
        // k=0 -> Level 1 (G).
        // k=1 -> Level 2 (B).
        // k=2 -> Level 3 (A).
        
        float wA = 0.0; if (uDepth >= 3) wA = (state.a > 0.05) ? 1.0 : 0.0;
        float wB = 0.0; if (uDepth >= 2) wB = (state.b > 0.05) ? 1.0 : 0.0;
        float wG = 0.0; if (uDepth >= 1) wG = (state.g > 0.05) ? 1.0 : 0.0;

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
            
            // Leaf Depth: how many won layers are above us?
            float leafDepth = wG; // At least G covers R if won?
            // Actually, if G is wont, it covers R. B covers G. A covers B.
            // If uDepth=2. Layers: G(1), R(0).
            // leafDepth = wG.
            // If uDepth=3. Layers: B, G, R.
            // leafDepth = wG + wB.
            // If uDepth=4. Layers: A, B, G, R.
            // leafDepth = wG + wB + wA.
            
            leafDepth = wG + wB + wA;
            
            float opacity = 1.0 - 0.2 * leafDepth;
            color = mix(color, symColor, drawStroke(dist, 0.3, localPx) * safeArea * opacity);
        }
        
        // 6. Loop: Smallest (L1/G) -> Largest (L3/A)
        for (int k = 0; k < 3; k++) {
            // k represents Distance from Leaf Level (0).
            // k=0 -> Level 1.
            // k=1 -> Level 2.
            
            // If k >= uDepth - 1, stop (don't have that level).
            // e.g. uDepth=2. Max level is 1. (Root).
            // k=0 (Level 1). OK.
            // k=1 (Level 2). Break.
            if (k >= uDepth) break; 
            
            float val = (k==0) ? state.g : (k==1) ? state.b : state.a;
            
            // levelIdx for 'uvLevels'. 
            // uvLevels[i] corresponds to loop i = 0..(uDepth-1).
            // i=0 is Root. i=uDepth-1 is Leaf Parent.
            // We want Leaf Parent for k=0.
            // So i = (uDepth - 1) - k.
            
            int levelIdx = (uDepth - 1) - k;
            
            if (val > 0.05) {
                bool isX = val < 0.6;
                float base = isX ? 0.3 : 0.7;
                float pFloat = (val - base) / 0.02;
                int pattern = int(floor(pFloat + 0.5));
                vec3 winColor = isX ? C_X : C_O;
                
                vec2 lUV = uvLevels[levelIdx];
                float lPx = pxLevels[levelIdx];
                
                // Air Depth
                float airDepth = 0.0;
                // Sum weights of levels > k+1 (Level k+1 is Depth k+1 from bottom?)
                // Levels: R(0), G(1), B(2), A(3).
                // k=0 (G). Covered by B(2) and A(3).
                // k=1 (B). Covered by A(3).
                // k=2 (A). Covered by None.
                
                if (k == 0) airDepth = wB + wA;
                else if (k == 1) airDepth = wA;
                
                float lvlOpacity = 1.0 - 0.1 * airDepth;

                // 1. Draw Line (Background)
                if (pattern >= 0 && pattern <= 7) {
                    vec4 coords = getWinLineCoords(pattern);
                    float dLine = sdSegment(lUV, coords.xy, coords.zw);
                    float lineMask = drawStroke(dLine, 0.10, lPx);
                    color = mix(color, winColor, lineMask * lvlOpacity * 0.6);
                }
                
                if (k < uDepth - 1) {
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
        }
        
        // 7. Hover Highlight
        int gx = int(floor(globalIdx.x + 0.5));
        int gy = int(floor(globalIdx.y + 0.5));

        if (gx == uHover.x && gy == uHover.y) {
            color += vec3(0.15) * safeArea;
        }
    }
    
    // 8. Outer Border
    float outerThick = OUTER_GAP;
    float distOuter = abs(sdBox(vUv - 0.5, vec2(0.5 - OUTER_GAP * 0.5)));
    float screenPx = fwidth(vUv.x);
    float outerMask = drawStroke(distOuter, OUTER_GAP, screenPx);
    if (uConstraint.z > 0.8) { 
        outerMask = 0.0;
    }
    color = mix(color, C_5X, outerMask);

    // 4. Glow Border
    if (uConstraint.z > 0.0) {
       vec2 gridStart = vec2(OUTER_GAP);
       vec2 gridSize = vec2(1.0 - 2.0 * OUTER_GAP);
       vec2 gridUV = (vUv - gridStart) / gridSize;
       
       vec2 center = uConstraint.xy + uConstraint.zw * 0.5;
       vec2 halfSize = uConstraint.zw * 0.5;
       float d = sdBox(gridUV - center, halfSize);
       float w = uConstraint.z;
       
       // Continuous thickness
       // Use uConstraintLevel to determine thickness.
       // Len 1 -> Level 0 Thickness (5.0).
       // Len 2 -> Level 1 Thickness (4.0).
       // Formula: 5.0 - (Len - 1) = 6.0 - Len.
       // uConstraintLevel is Len.
        
       float mult = 6.0 - float(uConstraintLevel);
       mult = max(mult, 1.0); 
        
       float goldThick = (BASE_GAP * mult) / gridSize.x; 
       float goldBorder = drawStroke(abs(d), goldThick, globalPx);
       float pulse = 0.6 + 0.4 * sin(uTime * 4.0);
       color = mix(color, C_GOLD, goldBorder * pulse);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
