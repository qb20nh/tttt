import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    ShaderMaterial,
    DataTexture,
    FloatType,
    NearestFilter,
    RGBAFormat,
    Vector2,
    Vector4,
    PlaneGeometry,
    Mesh,
    MathUtils
} from 'three';
import type Stats from 'stats.js';
import type { BoardNode, Player, Winner } from '../game/types';
import { BOARD_SIZE } from '../game/constants';
import { vertexShader, fragmentShader } from './shaders';
import { getConstraintRect, mapUVToCell } from './layout';

export interface Scene3DHandle {
    zoomIn: () => void;
    zoomOut: () => void;
    resetView: () => void;
}

interface Scene3DProps {
    board: BoardNode;
    activeConstraint: number[];
    currentPlayer: Player;
    winner: Winner;
    onMove: (x: number, y: number) => void;
    statsInstance: Stats | null;
    depth: number;
}

// HMR Persistence
let persistedZoom = 0.9;
let persistedPan = { x: 0, y: 0 };

export const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(({ board, activeConstraint, currentPlayer, winner, onMove, statsInstance, depth }, ref) => {
    // ... (refs)
    const mountRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<OrthographicCamera | null>(null);
    const materialRef = useRef<ShaderMaterial | null>(null);
    const textureRef = useRef<DataTexture | null>(null);
    const isDragging = useRef(false);
    const isHovering = useRef(true);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const lastMousePosition = useRef({ x: 0, y: 0 });
    const zoomLevel = useRef(persistedZoom);
    const panOffset = useRef(persistedPan);
    const [cursorClass, setCursorClass] = useState('cursor-default');

    // Smooth Transition State
    const playerValRef = useRef(currentPlayer === 'X' ? 0 : 1);

    // --- Interaction Helpers ---
    const updateCamera = useCallback(() => {
        if (!cameraRef.current || !rendererRef.current) return;
        const w = rendererRef.current.domElement.width;
        const h = rendererRef.current.domElement.height;
        const aspect = w / h;
        const zoom = zoomLevel.current;
        const px = panOffset.current.x;
        const py = panOffset.current.y;

        // View width = 2 * aspect / zoom
        const frusW = aspect / zoom;
        const frusH = 1.0 / zoom;

        cameraRef.current.left = -frusW + px;
        cameraRef.current.right = frusW + px;
        cameraRef.current.top = frusH + py;
        cameraRef.current.bottom = -frusH + py;
        cameraRef.current.updateProjectionMatrix();
    }, []);

    // Expose Controls
    useImperativeHandle(ref, () => ({
        zoomIn: () => {
            const newZoom = Math.min(zoomLevel.current * 1.2, 20);
            zoomLevel.current = newZoom;
            persistedZoom = newZoom;
            updateCamera();
        },
        zoomOut: () => {
            const newZoom = Math.max(zoomLevel.current / 1.2, 0.5);
            zoomLevel.current = newZoom;
            persistedZoom = newZoom;
            updateCamera();
        },
        resetView: () => {
            zoomLevel.current = 0.9;
            panOffset.current = { x: 0, y: 0 };
            persistedZoom = 0.9;
            persistedPan = { x: 0, y: 0 };
            updateCamera();
        }
    }));

    const transitionRef = useRef({ start: 0, target: 0, startTime: 0 });

    // --- Board State to Texture ---
    const updateTexture = useCallback(() => {
        if (!textureRef.current || !board) return;

        const size = BOARD_SIZE * BOARD_SIZE;
        const data = textureRef.current.image.data;
        if (!data) return;

        // Reset
        for (let i = 0; i < size * 4; i++) data[i] = 0;

        const traverse = (node: BoardNode, x: number, y: number, currentDepth: number) => {
            // 1. Mark Leaf
            if (currentDepth === 0) {
                if (node.value) {
                    const idx = (y * BOARD_SIZE + x) * 4;
                    // r channel uses 0..1 range. 0.3 for X, 0.7 for O
                    data[idx] = node.value === 'X' ? 0.3 : 0.7;
                }
                return;
            }

            // 2. Mark Node Winner/Value
            const val = node.winner || node.value;
            if (val) {
                // Flood fill this node's area in the appropriate channel
                // We map depth to channel. 
                // Leaf (depth 0) -> R (channel 0)
                // Depth 1 -> G (channel 1)
                // Depth 2 -> B (channel 2)
                // Depth 3 -> A (channel 3)
                // This assumes Max Depth 4. If Depth is 2, we use channels 0 and 1.
                // We need to know 'level from bottom'. currentDepth IS level from bottom.

                const channel = currentDepth;

                // Pattern logic encoded in value (0.3/0.7 + pattern offsets)
                const floatVal = (val === 'X' ? 0.3 : 0.7) + (node.winPattern >= 0 ? 0.02 * node.winPattern : 0);

                const startX = x;
                const startY = y;
                const dim = Math.pow(3, currentDepth);

                for (let dy = 0; dy < dim; dy++) {
                    for (let dx = 0; dx < dim; dx++) {
                        const px = startX + dx;
                        const py = startY + dy;
                        if (px < BOARD_SIZE && py < BOARD_SIZE) {
                            const idx = (py * BOARD_SIZE + px) * 4;
                            data[idx + channel] = floatVal;
                        }
                    }
                }
            }

            if (node.children) {
                const childSize = Math.pow(3, currentDepth - 1);
                for (let i = 0; i < 9; i++) {
                    const childNode = node.children[i];
                    const cx = x + (i % 3) * childSize;
                    const cy = y + Math.floor(i / 3) * childSize;
                    traverse(childNode, cx, cy, currentDepth - 1);
                }
            }
        };

        traverse(board, 0, 0, depth);
        textureRef.current.needsUpdate = true;
    }, [board, depth]);

    // --- Initialization ---
    useEffect(() => {
        if (!mountRef.current) return;

        // Renderer
        const renderer = new WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        mountRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Scene & Cam
        const scene = new Scene();
        sceneRef.current = scene;
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        camera.position.z = 1;
        cameraRef.current = camera;

        // State Texture
        const size = BOARD_SIZE * BOARD_SIZE;
        const data = new Float32Array(size * 4);
        const texture = new DataTexture(data, BOARD_SIZE, BOARD_SIZE, RGBAFormat, FloatType);
        texture.magFilter = NearestFilter;
        texture.minFilter = NearestFilter;
        texture.needsUpdate = true;
        textureRef.current = texture;

        // Material
        const initialPlayerVal = currentPlayer === 'X' ? 0 : 1;
        const initialConstraint = getConstraintRect(activeConstraint, depth);
        const material = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uStateTexture: { value: texture },
                uHover: { value: new Vector2(-1, -1) },
                uConstraint: { value: new Vector4(initialConstraint.x, initialConstraint.y, initialConstraint.w, initialConstraint.h) },
                uPlayer: { value: initialPlayerVal },
                uTime: { value: 0 },
                uDepth: { value: depth }
            },
        });
        materialRef.current = material;
        playerValRef.current = initialPlayerVal; // Sync ref too

        // Geometry
        const geometry = new PlaneGeometry(2, 2);
        const mesh = new Mesh(geometry, material);
        scene.add(mesh);
        // Loop Logic
        let lastTime = performance.now();
        let animationId: number;
        let lastInputTime = performance.now();

        const handleInput = () => {
            lastInputTime = performance.now();
        };

        const handleEnter = () => { isHovering.current = true; };
        const handleLeave = () => { isHovering.current = false; };

        window.addEventListener('pointermove', handleInput);
        window.addEventListener('wheel', handleInput);
        window.addEventListener('pointerdown', handleInput);
        window.addEventListener('keydown', handleInput);
        document.body.addEventListener('pointerenter', handleEnter);
        document.body.addEventListener('pointerleave', handleLeave);

        const renderFrame = (t: number, dt: number) => {
            material.uniforms.uTime.value = t * 0.001;

            // Animate Player Color Transition
            const { start: colorStart, target, startTime } = transitionRef.current;
            const now = performance.now();
            const duration = 250; // ms
            let p = (now - startTime) / duration;
            p = Math.max(0, Math.min(1, p));
            // smoothstep ease
            const ease = MathUtils.smoothstep(p, 0, 1);
            const val = MathUtils.lerp(colorStart, target, ease);

            playerValRef.current = val;
            material.uniforms.uPlayer.value = val;

            // Animate Constraint
            const decay = 15.0; // Adjustable speed
            const alpha = 1.0 - Math.exp(-decay * dt);

            constraintRef.current.lerp(targetConstraintRef.current, alpha);

            // Snap if close enough (Manual Manhattan distance)
            const d = Math.abs(constraintRef.current.x - targetConstraintRef.current.x) +
                Math.abs(constraintRef.current.y - targetConstraintRef.current.y) +
                Math.abs(constraintRef.current.z - targetConstraintRef.current.z) +
                Math.abs(constraintRef.current.w - targetConstraintRef.current.w);

            if (d < 0.001) {
                constraintRef.current.copy(targetConstraintRef.current);
            }
            material.uniforms.uConstraint.value.copy(constraintRef.current);

            renderer.render(scene, camera);
        };

        const animate = (time: number) => {
            animationId = requestAnimationFrame(animate);

            // 1. Background / Inactive Tab Check
            if (document.hidden) {
                return;
            }

            // Limit to 10 FPS ONLY if Unfocused AND Not Hovering
            if (!document.hasFocus() && !isHovering.current) {
                const bgInterval = 100; // 10 FPS
                const delta = time - lastTime;

                if (delta > bgInterval) {
                    const dt = Math.min(delta / 1000, 0.1);
                    lastTime = time - (delta % bgInterval);
                    statsInstance?.begin();
                    renderFrame(time, dt);
                    statsInstance?.end();
                }
                return;
            }

            // 2. Dragging (Highest Priority) - Uncapped VSync 
            if (isDragging.current) {
                const dt = Math.min((time - lastTime) / 1000, 0.1);
                statsInstance?.begin();
                renderFrame(time, dt);
                statsInstance?.end();
                lastTime = time;
                return;
            }

            // 3. Dynamic FPS (Active vs Idle)
            const isActive = (time - lastInputTime) < 2000; // Active for 2s after input

            if (isActive) {
                // Active: Uncapped (VSync Limit)
                const dt = Math.min((time - lastTime) / 1000, 0.1);
                statsInstance?.begin();
                renderFrame(time, dt);
                statsInstance?.end();
                lastTime = time;
            } else {
                // Idle: Throttled to 48 FPS to save power
                const targetFPS = 48;
                const interval = 1000 / targetFPS;
                const delta = time - lastTime;

                if (delta > interval) {
                    const dt = Math.min(delta / 1000, 0.1);
                    lastTime = time - (delta % interval);
                    statsInstance?.begin();
                    renderFrame(time, dt);
                    statsInstance?.end();
                }
            }
        };
        animationId = requestAnimationFrame(animate);

        // Resize
        const handleResize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderer.setSize(w, h);
            updateCamera();
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        // Clean up
        const node = mountRef.current;
        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('pointermove', handleInput);
            window.removeEventListener('wheel', handleInput);
            window.removeEventListener('pointerdown', handleInput);
            window.removeEventListener('keydown', handleInput);
            document.body.removeEventListener('pointerenter', handleEnter);
            document.body.removeEventListener('pointerleave', handleLeave);

            renderer.dispose();
            texture.dispose();
            material.dispose();
            geometry.dispose();
            if (node) node.removeChild(renderer.domElement);
        };
    }, [updateCamera, statsInstance]); // eslint-disable-line react-hooks/exhaustive-deps
    // Actually, if depth changes, material needs update for uDepth.
    // texture needs update.
    // geometry is same.
    // If we want uDepth to update, we can do it in a separate useEffect.

    // --- Texture & Uniform Updates ---
    useEffect(() => {
        updateTexture();
    }, [updateTexture, board]);

    // Constraint Animation State
    const initialRect = getConstraintRect(activeConstraint, depth);
    const constraintRef = useRef(new Vector4(initialRect.x, initialRect.y, initialRect.w, initialRect.h));
    const targetConstraintRef = useRef(new Vector4(initialRect.x, initialRect.y, initialRect.w, initialRect.h));

    useEffect(() => {
        if (materialRef.current) {
            let rect = getConstraintRect(activeConstraint, depth);

            // If game is over (winner exists), hide the constraint glow
            if (winner) {
                rect = { x: 0, y: 0, w: 0, h: 0 };
            }

            targetConstraintRef.current.set(rect.x, rect.y, rect.w, rect.h);

            // Also update depth uniform!
            materialRef.current.uniforms.uDepth.value = depth;

            const target = currentPlayer === 'X' ? 0 : 1;
            // Start transition from CURRENT value
            transitionRef.current = {
                start: playerValRef.current,
                target: target,
                startTime: performance.now()
            };
        }
    }, [activeConstraint, currentPlayer, depth, winner]);

    const getUV = (e: React.MouseEvent | MouseEvent) => {
        if (!rendererRef.current) return { x: -1, y: -1 };
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        // Normalized Device Coordinates (-1 to 1)
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const w = rendererRef.current.domElement.width;
        const h = rendererRef.current.domElement.height;
        const aspect = w / h;
        const zoom = zoomLevel.current;

        // Map NDC back to World Space based on current camera
        const worldX = ndcX * (aspect / zoom) + panOffset.current.x;
        const worldY = ndcY * (1.0 / zoom) + panOffset.current.y;

        // UV 0 is at -1, UV 1 is at 1.
        const uvX = (worldX + 1) / 2;
        const uvY = (worldY + 1) / 2;

        return { x: uvX, y: uvY };
    };

    // --- Event Handlers ---
    const handleWheel = (e: React.WheelEvent) => {
        if (!rendererRef.current) return;

        // Calculate mouse position relative to center (NDC-like but scaling with aspect)
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        // NDC (-1 to 1)
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const w = rendererRef.current.domElement.width;
        const h = rendererRef.current.domElement.height;
        const aspect = w / h;

        // Current World Position of mouse
        const oldZoom = zoomLevel.current;
        const mouseWorldX = ndcX * (aspect / oldZoom) + panOffset.current.x;
        const mouseWorldY = ndcY * (1.0 / oldZoom) + panOffset.current.y;

        const factor = 1.1;
        let newZoom = oldZoom;
        if (e.deltaY < 0) newZoom *= factor;
        else newZoom /= factor;

        newZoom = Math.min(Math.max(newZoom, 0.5), 20);
        zoomLevel.current = newZoom;
        persistedZoom = newZoom;

        // Calculate new Pan Offset to keep mouseWorldX at same NDC
        // mouseWorldX = ndcX * (aspect / newZoom) + newPanX
        // newPanX = mouseWorldX - ndcX * (aspect / newZoom)

        panOffset.current.x = mouseWorldX - ndcX * (aspect / newZoom);
        panOffset.current.y = mouseWorldY - ndcY * (1.0 / newZoom);
        persistedPan = { ...panOffset.current };

        updateCamera();
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        // Allow Left (0) or Middle (1) to start interaction
        if (e.button !== 0 && e.button !== 1) return;

        isDragging.current = false; // Start assumption: Click
        dragStartPos.current = { x: e.clientX, y: e.clientY };
        lastMousePosition.current = { x: e.clientX, y: e.clientY };
        setCursorClass('cursor-grabbing');
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // Pan Logic
        // Pan Logic (Left=1, Middle=4 in e.buttons)
        if ((e.buttons & 1) || (e.buttons & 4)) {
            const dx = e.clientX - lastMousePosition.current.x;
            const dy = e.clientY - lastMousePosition.current.y;

            // Check for drag threshold if not yet dragging
            if (!isDragging.current) {
                const moveDist = Math.hypot(e.clientX - dragStartPos.current.x, e.clientY - dragStartPos.current.y);
                if (moveDist > 5) isDragging.current = true;
            }

            if (isDragging.current) {
                lastMousePosition.current = { x: e.clientX, y: e.clientY };

                const w = rendererRef.current?.domElement.width || 1;
                const h = rendererRef.current?.domElement.height || 1;
                const aspect = w / h;

                const worldWidth = (2 * aspect) / zoomLevel.current;
                const worldHeight = 2.0 / zoomLevel.current;

                panOffset.current.x -= (dx / w) * worldWidth;
                panOffset.current.y += (dy / h) * worldHeight;
                // eslint-disable-next-line
                persistedPan = { ...panOffset.current };

                updateCamera();
                return;
            }
            // Block hover logic if button down but not dragging
            return;
        } else {
            // If button not held but we thought we were dragging (e.g. out of window release), reset
            if (isDragging.current) isDragging.current = false;
        }

        // Hover Logic
        const uv = getUV(e);
        if (!materialRef.current) return;

        if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
            const mapped = mapUVToCell(uv, depth);
            if (mapped.valid) {
                materialRef.current.uniforms.uHover.value.set(mapped.x, mapped.y);

                // Cursor Logic
                if (activeConstraint.length === 0 || isInsideConstraint(uv, activeConstraint)) {
                    setCursorClass('cursor-crosshair');
                } else {
                    // Only show "not-allowed" if trying to interact (button down)
                    if (e.buttons !== 0) setCursorClass('cursor-not-allowed');
                    else setCursorClass('cursor-default');
                }
            } else {
                materialRef.current.uniforms.uHover.value.set(-1, -1);
                setCursorClass('cursor-default');
            }
        } else {
            materialRef.current.uniforms.uHover.value.set(-1, -1);
            setCursorClass('cursor-default');
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (!isDragging.current && e.button === 0) {
            // Click
            const uv = getUV(e);
            if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
                const mapped = mapUVToCell(uv, depth);
                if (mapped.valid) {
                    onMove(mapped.x, mapped.y);
                }
            }
        }
        isDragging.current = false;
        // Trigger hover update to restore cursor
        handleMouseMove(e);
    };

    useEffect(() => {
        const onUp = () => { isDragging.current = false; };
        window.addEventListener('mouseup', onUp);
        return () => window.removeEventListener('mouseup', onUp);
    }, []);

    const isInsideConstraint = (uv: { x: number, y: number }, constraint: number[]) => {
        const rect = getConstraintRect(constraint, depth);
        return (uv.x >= rect.x && uv.x <= rect.x + rect.w &&
            uv.y >= rect.y && uv.y <= rect.y + rect.h);
    };

    // Initial Camera Update
    useEffect(() => {
        setTimeout(updateCamera, 0);
    }, [updateCamera]);

    return (
        <div className="h-screen w-screen bg-black overflow-hidden relative">
            <div
                ref={mountRef}
                className={`w-full h-full ${cursorClass}`}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={e => e.preventDefault()}
            />
        </div>
    );
}); // Close forwardRef
