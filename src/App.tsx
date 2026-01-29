import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { RotateCcw, X as XIcon } from 'lucide-react';

// --- Types ---
type Player = 'X' | 'O';
type Winner = Player | null;

interface BoardNode {
  winner: Winner;
  winPattern: number;
  value: Winner;
  children?: BoardNode[] | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- Game Logic Constants ---
const DEPTH = 4;

// --- Constants for Layout ---
const BASE_GAP = 0.000625;
const OUTER_GAP = 5.0 * BASE_GAP;

// --- Initial Game State Logic ---

const generateBoard = (currentDepth: number): BoardNode => {
  if (currentDepth === 0) return { winner: null, winPattern: -1, value: null, children: null };
  return {
    winner: null,
    winPattern: -1,
    value: null,
    children: Array(9).fill(null).map(() => generateBoard(currentDepth - 1)),
  };
};

const WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const checkWin = (cells: BoardNode[]) => {
  for (let i = 0; i < WIN_PATTERNS.length; i++) {
    const [a, b, c] = WIN_PATTERNS[i];
    const valA = cells[a].winner || cells[a].value;
    const valB = cells[b].winner || cells[b].value;
    const valC = cells[c].winner || cells[c].value;
    if (valA && valA === valB && valA === valC) {
      return { winner: valA as Player, pattern: i };
    }
  }
  return null;
};

const isFull = (board: BoardNode): boolean => {
  if (board.winner) return true;
  if (!board.children) return board.value !== null;
  return board.children.every(child =>
    (child.winner !== null) || (child.value !== null) || isFull(child)
  );
};

// --- Shader Code ---

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  
  uniform sampler2D uStateTexture;
  uniform vec2 uHover;
  uniform vec4 uConstraint;
  uniform float uTime;
  
  const vec3 C_BG = vec3(0.05, 0.07, 0.12);
  const vec3 C_1X = vec3(0.3, 0.3, 0.3);
  const vec3 C_2X = vec3(0.5, 0.5, 0.5);
  const vec3 C_3X = vec3(0.1, 0.25, 0.55);
  const vec3 C_4X = vec3(0.4, 0.6, 0.9);
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
      if (pattern == 0) return vec4(start, c0, end, c0);
      if (pattern == 1) return vec4(start, c1, end, c1);
      if (pattern == 2) return vec4(start, c2, end, c2);
      if (pattern == 3) return vec4(c2, end, c2, start);
      if (pattern == 4) return vec4(c1, end, c1, start);
      if (pattern == 5) return vec4(c0, end, c0, start);
      if (pattern == 6) return vec4(start, end, end, start);
      if (pattern == 7) return vec4(end, end, start, start);
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

    vec3 color = C_BG;
    
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
        color = mix(color, C_1X, borderMasks[3]);
        color = mix(color, C_2X, borderMasks[2]);
        color = mix(color, C_3X, borderMasks[1]);
        color = mix(color, C_4X, borderMasks[0]);
        
        // 4. Glow Border
        if (uConstraint.z > 0.0) {
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
            color = mix(color, symColor, drawStroke(dist, 0.3, localPx) * safeArea);
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
                
                // Draw Line
                if (pattern >= 0 && pattern <= 7) {
                    vec4 coords = getWinLineCoords(pattern);
                    float dLine = sdSegment(lUV, coords.xy, coords.zw);
                    float lineMask = drawStroke(dLine, 0.05, lPx);
                    color = mix(color, winColor, lineMask);
                }
                
                // Draw Symbol
                vec2 p = lUV * 2.0 - 1.0;
                float dSym = 0.0;
                if (isX) {
                     float d1 = sdSegment(p, vec2(-0.8, -0.8), vec2(0.8, 0.8));
                     float d2 = sdSegment(p, vec2(-0.8, 0.8), vec2(0.8, -0.8));
                     dSym = min(d1, d2);
                } else {
                     dSym = abs(length(p) - 0.8);
                }
                float symMask = drawStroke(dSym, 0.08, lPx);
                color = mix(color, winColor, symMask * 0.6); 
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
    color = mix(color, C_5X, outerMask);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// --- Exact Visual Constraint Calculator ---
const getConstraintRect = (constraint: number[]): Rect => {
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
    const d = 4 - i;

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

  const gapLevel = 5 - constraint.length;
  const rawGap = BASE_GAP * gapLevel;
  const expansion = (rawGap / gridSizeScale) / 2.0;

  x -= expansion;
  y -= expansion;
  w += 2.0 * expansion;
  h += 2.0 * expansion;

  return { x, y, w, h };
};

// --- Recursive Coordinate Math (JS) ---
const mapUVToCell = (uv: { x: number, y: number }): { valid: boolean, x: number, y: number } => {
  if (uv.x < OUTER_GAP || uv.x > 1.0 - OUTER_GAP ||
    uv.y < OUTER_GAP || uv.y > 1.0 - OUTER_GAP) {
    return { valid: false, x: -1, y: -1 };
  }

  let localU = (uv.x - OUTER_GAP) / (1.0 - 2.0 * OUTER_GAP);
  let localV = (uv.y - OUTER_GAP) / (1.0 - 2.0 * OUTER_GAP);

  let idxX = 0;
  let idxY = 0;
  let currentScale = 1.0;

  for (let i = 0; i < 4; i++) {
    const d = 4 - i;
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

// --- Main Component ---

export default function TripleNestedTTT() {
  const [board, setBoard] = useState<BoardNode>(() => generateBoard(DEPTH));
  const [currentPlayer, setCurrentPlayer] = useState<Player>('X');
  const [activeConstraint, setActiveConstraint] = useState<number[]>([]);
  const [winner, setWinner] = useState<Winner>(null);

  // Interaction State
  const [cursorClass, setCursorClass] = useState('cursor-default');

  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>(null);
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const textureRef = useRef<THREE.DataTexture>(null);
  const dataArrayRef = useRef(new Float32Array(81 * 81 * 4));

  const [showIntro, setShowIntro] = useState(true);

  // --- Texture Update ---
  const updateTexture = useCallback((currentBoard: BoardNode) => {
    const data = dataArrayRef.current;
    data.fill(0);

    // Encodes value 0..1 based on X/O and Pattern
    const encode = (winner: Winner, pattern: number) => {
      if (!winner) return 0.0;
      const base = (winner === 'X') ? 0.3 : 0.7;
      const pVal = (pattern >= 0) ? (pattern * 0.02) : 0.0;
      return base + pVal;
    };

    const traverse = (node: BoardNode, path: number[], winners: { l3: number, l2: number, l1: number }) => {
      const currentWinners = { ...winners };

      // Check for wins at this level
      if (node.winner) {
        const val = encode(node.winner, node.winPattern);
        if (path.length === 1) currentWinners.l3 = val;
        if (path.length === 2) currentWinners.l2 = val;
        if (path.length === 3) currentWinners.l1 = val;
      }

      if (path.length === 4) {
        let x = 0;
        let y = 0;
        x += (path[0] % 3) * 27; y += Math.floor(path[0] / 3) * 27;
        x += (path[1] % 3) * 9; y += Math.floor(path[1] / 3) * 9;
        x += (path[2] % 3) * 3; y += Math.floor(path[2] / 3) * 3;
        x += (path[3] % 3); y += Math.floor(path[3] / 3);

        const glY = 80 - y;
        const index = (glY * 81 + x) * 4;

        // R: Leaf
        data[index] = encode(node.winner || node.value, -1);

        // G: L1 (Mini)
        data[index + 1] = currentWinners.l1 || 0.0;

        // B: L2 (Macro)
        data[index + 2] = currentWinners.l2 || 0.0;

        // A: L3 (Mega)
        data[index + 3] = currentWinners.l3 || 0.0;

        return;
      }

      if (node.children) {
        node.children.forEach((child, i) => traverse(child, [...path, i], currentWinners));
      }
    };

    traverse(currentBoard, [], { l3: 0.0, l2: 0.0, l1: 0.0 });
    if (textureRef.current) textureRef.current.needsUpdate = true;
  }, []);

  // --- Initialize Three.js ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    const frustumHeight = 1.2;
    const frustumWidth = frustumHeight * aspect;

    const camera = new THREE.OrthographicCamera(
      0.5 - frustumWidth / 2, 0.5 + frustumWidth / 2,
      0.5 + frustumHeight / 2, 0.5 - frustumHeight / 2,
      0.1, 1000
    );
    camera.position.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const dataTexture = new THREE.DataTexture(dataArrayRef.current, 81, 81, THREE.RGBAFormat, THREE.FloatType);
    dataTexture.magFilter = THREE.NearestFilter;
    dataTexture.minFilter = THREE.NearestFilter;
    dataTexture.needsUpdate = true;
    textureRef.current = dataTexture;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uStateTexture: { value: dataTexture },
        uHover: { value: new THREE.Vector2(-1, -1) },
        uConstraint: { value: new THREE.Vector4(0, 0, 1, 1) },
        uTime: { value: 0 },
      },
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0.5, 0.5, 0);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    updateTexture(board);

    let af: number;
    const animate = (time: number) => {
      material.uniforms.uTime.value = time * 0.001;
      renderer.render(scene, camera);
      af = requestAnimationFrame(animate);
    };
    animate(0);

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const aspect = w / h;
      const cam = cameraRef.current;
      const currentHeight = cam.top - cam.bottom;
      const newWidth = currentHeight * aspect;
      const centerX = (cam.left + cam.right) / 2;
      cam.left = centerX - newWidth / 2;
      cam.right = centerX + newWidth / 2;
      cam.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      cancelAnimationFrame(af);
      window.removeEventListener('resize', handleResize);
      if (mount && renderer.domElement) mount.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      dataTexture.dispose();
      renderer.dispose();
    };
  }, [board, updateTexture]);

  useEffect(() => { updateTexture(board); }, [board, updateTexture]);

  // Sync Constraints to Shader
  useEffect(() => {
    if (materialRef.current) {
      const rect = getConstraintRect(activeConstraint);
      const glY = 1.0 - (rect.y + rect.h);
      materialRef.current.uniforms.uConstraint.value.set(rect.x, glY, rect.w, rect.h);
    }
  }, [activeConstraint]);

  // --- Helpers ---
  const isValidMove = (gridX: number, gridY: number) => {
    const gameY = 80 - gridY;
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

    if (activeConstraint.length > 0) {
      for (let i = 0; i < activeConstraint.length; i++) {
        if (activeConstraint[i] !== fullPath[i]) return false;
      }
    }

    let node: BoardNode = board;
    for (let i = 0; i < 4; i++) {
      const idx = fullPath[i];
      if (node.winner !== null) return false;

      if (i === 3) {
        if (node.value !== null) return false;
      } else {
        if (isFull(node)) return false;
        if (!node.children) return false;
        node = node.children[idx];
      }
    }

    return true;
  };

  const isInsideConstraint = (uv: { x: number, y: number }, constraint: number[]) => {
    const gridSize = 1.0 - 2.0 * OUTER_GAP;
    const gridU = (uv.x - OUTER_GAP) / gridSize;
    const gridV = (uv.y - OUTER_GAP) / gridSize;

    if (gridU < 0 || gridU > 1 || gridV < 0 || gridV > 1) return false;

    const rect = getConstraintRect(constraint);

    const rectBottom = 1.0 - (rect.y + rect.h);
    const rectTop = 1.0 - rect.y;

    return (
      gridU >= rect.x && gridU <= rect.x + rect.w &&
      gridV >= rectBottom && gridV <= rectTop
    );
  };

  // --- Interaction ---

  const lastMouse = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const getUV = (e: React.MouseEvent | React.WheelEvent) => {
    if (!rendererRef.current || !cameraRef.current) return { x: -1, y: -1 };
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const cam = cameraRef.current;

    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    const worldX = cam.left + nx * (cam.right - cam.left);
    const worldY = cam.top + ny * (cam.bottom - cam.top);

    return { x: worldX, y: worldY };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    if (!cam) return;

    const zoomSensitivity = 0.001;
    const zoomFactor = Math.exp(e.deltaY * zoomSensitivity);

    const uv = getUV(e);
    const mouseX = uv.x;
    const mouseY = uv.y;

    const w = cam.right - cam.left;
    const h = cam.top - cam.bottom;

    let newW = w * zoomFactor;
    let newH = h * zoomFactor;

    if (newW > 2.5) { const r = 2.5 / newW; newW = 2.5; newH *= r; }
    if (newW < 0.035) { const r = 0.035 / newW; newW = 0.035; newH *= r; }

    const alphaX = (mouseX - cam.left) / w;
    const alphaY = (mouseY - cam.bottom) / h;

    cam.left = mouseX - alphaX * newW;
    cam.right = cam.left + newW;
    cam.bottom = mouseY - alphaY * newH;
    cam.top = cam.bottom + newH;

    cam.updateProjectionMatrix();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    lastMouse.current = { x: e.clientX, y: e.clientY };
    dragStart.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;

    const uv = getUV(e);
    const insideGlow = isInsideConstraint(uv, activeConstraint);
    if (!insideGlow) {
      setCursorClass('cursor-not-allowed');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const uv = getUV(e);
    const insideGlow = isInsideConstraint(uv, activeConstraint);

    let shaderHover = { x: -1, y: -1 };

    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      const mapped = mapUVToCell(uv);
      if (mapped.valid) {
        const valid = isValidMove(mapped.x, mapped.y);
        if (valid) {
          shaderHover = { x: mapped.x, y: mapped.y };
        }
      }
    }

    if (materialRef.current) {
      materialRef.current.uniforms.uHover.value.set(shaderHover.x, shaderHover.y);
    }

    // Drag detection
    if (e.buttons !== 0 && !isDragging.current) {
      if (Math.abs(e.clientX - dragStart.current.x) > 5 || Math.abs(e.clientY - dragStart.current.y) > 5) {
        isDragging.current = true;
      }
    }

    let newCursor = 'cursor-default';
    if (isDragging.current) {
      newCursor = 'cursor-grabbing';
    } else if (insideGlow) {
      newCursor = 'cursor-crosshair';
    } else {
      if (e.buttons !== 0) {
        newCursor = 'cursor-not-allowed';
      } else {
        newCursor = 'cursor-default';
      }
    }

    if (cursorClass !== newCursor) setCursorClass(newCursor);

    // Pan
    if (e.buttons === 0) return;
    const cam = cameraRef.current;
    if (!cam) return;

    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };

    if (isDragging.current) {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const viewW = cam.right - cam.left;
      const viewH = cam.top - cam.bottom;
      const unitsPerPixelX = viewW / rect.width;
      const unitsPerPixelY = viewH / rect.height;

      const moveX = -dx * unitsPerPixelX;
      const moveY = dy * unitsPerPixelY;

      cam.left += moveX;
      cam.right += moveX;
      cam.top += moveY;
      cam.bottom += moveY;

      cam.updateProjectionMatrix();
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      setCursorClass('cursor-default');
      return;
    }

    const uv = getUV(e);
    const insideGlow = isInsideConstraint(uv, activeConstraint);
    setCursorClass(insideGlow ? 'cursor-crosshair' : 'cursor-default');

    if (e.button === 0) {
      if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
        const mapped = mapUVToCell(uv);
        if (mapped.valid && isValidMove(mapped.x, mapped.y)) {
          handleMove(mapped.x, mapped.y);
        }
      }
    }
    isDragging.current = false;
  };

  const handleMove = (gridX: number, gridY: number) => {
    if (winner) return;

    const gameY = 80 - gridY;
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

  return (
    <div className="h-screen w-screen bg-black overflow-hidden relative">
      <div
        ref={mountRef}
        className={`w-full h-full ${cursorClass}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      <div className="absolute top-4 left-4 text-white pointer-events-none">
        <h1 className="text-2xl font-bold text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">NEON FRACTAL 81</h1>
        <div className="mt-2 text-sm text-slate-400">
          Current Turn: <span className={currentPlayer === 'X' ? 'text-cyan-400' : 'text-pink-500'}>{currentPlayer}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
        <button onClick={resetGame} className="p-2 bg-slate-800 text-white rounded hover:bg-slate-700 pointer-events-auto border border-slate-600">
          <RotateCcw size={20} />
        </button>
      </div>

      {winner && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50 pointer-events-auto">
          <div className="text-center">
            <h2 className="text-6xl font-bold text-white mb-4">VICTORY</h2>
            <div className={`text-9xl font-black ${winner === 'X' ? 'text-cyan-400' : 'text-pink-500'} drop-shadow-[0_0_50px_currentColor]`}>
              {winner}
            </div>
            <button onClick={resetGame} className="mt-8 px-8 py-3 bg-white text-black font-bold rounded-full hover:scale-110 transition">
              PLAY AGAIN
            </button>
          </div>
        </div>
      )}

      {showIntro && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-slate-900 max-w-lg w-full p-6 rounded-2xl border border-slate-700 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">Shader Edition</h2>
              <button onClick={() => setShowIntro(false)}><XIcon className="text-white" /></button>
            </div>
            <div className="space-y-4 text-sm text-slate-300">
              <p><strong>Perfect AA Rendering:</strong> This version runs purely on the GPU.</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Infinite Zoom:</strong> Scroll to zoom seamlessly from the God Board down to sub-atomic cells.</li>
                <li><strong>Neon Grid:</strong> Procedural SDFs ensure lines are always crisp.</li>
              </ul>
              <div className="pt-4 flex justify-end">
                <button onClick={() => setShowIntro(false)} className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg">Enter Grid</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}