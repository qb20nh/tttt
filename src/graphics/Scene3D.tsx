import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { BoardNode } from '../game/types';
import { BOARD_SIZE, DEPTH } from '../game/constants';
import { vertexShader, fragmentShader } from './shaders';
import { getConstraintRect, mapUVToCell } from './layout';

interface Scene3DProps {
    board: BoardNode;
    activeConstraint: number[];
    onMove: (x: number, y: number) => void;
}

export const Scene3D = ({ board, activeConstraint, onMove }: Scene3DProps) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const materialRef = useRef<THREE.ShaderMaterial | null>(null);
    const textureRef = useRef<THREE.DataTexture | null>(null);
    const isDragging = useRef(false);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const lastMousePosition = useRef({ x: 0, y: 0 });
    const zoomLevel = useRef(1);
    const panOffset = useRef({ x: 0, y: 0 });
    const [cursorClass, setCursorClass] = useState('cursor-default');

    // --- Board State to Texture ---
    const updateTexture = useCallback(() => {
        if (!textureRef.current || !board) return;

        const size = BOARD_SIZE * BOARD_SIZE;
        const data = textureRef.current.image.data;
        if (!data) return;

        // Reset
        for (let i = 0; i < size * 4; i++) data[i] = 0;

        const traverse = (node: BoardNode, x: number, y: number, depth: number) => {
            // 1. Mark Leaf
            if (depth === 0) {
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
                const channel = depth === 1 ? 1 : depth === 2 ? 2 : 3; // g, b, a
                // Pattern logic encoded in value (0.3/0.7 + pattern offsets)
                const floatVal = (val === 'X' ? 0.3 : 0.7) + (node.winPattern >= 0 ? 0.02 * node.winPattern : 0);

                const startX = x;
                const startY = y;
                const dim = Math.pow(3, depth);

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
                const childSize = Math.pow(3, depth - 1);
                for (let i = 0; i < 9; i++) {
                    const childNode = node.children[i];
                    const cx = x + (i % 3) * childSize;
                    const cy = y + Math.floor(i / 3) * childSize;
                    traverse(childNode, cx, cy, depth - 1);
                }
            }
        };

        traverse(board, 0, 0, DEPTH);
        textureRef.current.needsUpdate = true;
    }, [board]);

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

    // --- Initialization ---
    useEffect(() => {
        if (!mountRef.current) return;

        // Renderer
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        mountRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Scene & Cam
        const scene = new THREE.Scene();
        sceneRef.current = scene;
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        camera.position.z = 1;
        cameraRef.current = camera;

        // State Texture
        const size = BOARD_SIZE * BOARD_SIZE;
        const data = new Float32Array(size * 4);
        const texture = new THREE.DataTexture(data, BOARD_SIZE, BOARD_SIZE, THREE.RGBAFormat, THREE.FloatType);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        textureRef.current = texture;

        // Material
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uStateTexture: { value: texture },
                uHover: { value: new THREE.Vector2(-1, -1) },
                uConstraint: { value: new THREE.Vector4(0, 0, 1, 1) },
                uTime: { value: 0 },
            },
        });
        materialRef.current = material;

        // Geometry
        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Loop
        let animationId: number;
        const animate = (time: number) => {
            material.uniforms.uTime.value = time * 0.001;
            renderer.render(scene, camera);
            animationId = requestAnimationFrame(animate);
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
            renderer.dispose();
            texture.dispose();
            material.dispose();
            geometry.dispose();
            if (node) node.removeChild(renderer.domElement);
        };
    }, [updateCamera]);

    // --- Texture & Uniform Updates ---
    useEffect(() => {
        updateTexture();
    }, [updateTexture, board]);

    useEffect(() => {
        if (materialRef.current) {
            const rect = getConstraintRect(activeConstraint);
            materialRef.current.uniforms.uConstraint.value.set(rect.x, rect.y, rect.w, rect.h);
        }
    }, [activeConstraint]);

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

        newZoom = Math.min(Math.max(newZoom, 0.5), 50);
        zoomLevel.current = newZoom;

        // Calculate new Pan Offset to keep mouseWorldX at same NDC
        // mouseWorldX = ndcX * (aspect / newZoom) + newPanX
        // newPanX = mouseWorldX - ndcX * (aspect / newZoom)

        panOffset.current.x = mouseWorldX - ndcX * (aspect / newZoom);
        panOffset.current.y = mouseWorldY - ndcY * (1.0 / newZoom);

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
            const mapped = mapUVToCell(uv);
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
                const mapped = mapUVToCell(uv);
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
        const rect = getConstraintRect(constraint);
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
};
