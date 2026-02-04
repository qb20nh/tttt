import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
} from 'react'
import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  ShaderMaterial,
  DataTexture,
  Vector4,
  MathUtils,
} from 'three'
import type Stats from 'stats.js'
import type { BoardNode, Player, Winner } from '../game/types'
import { BOARD_SIZE } from '../game/constants'
import { getConstraintRect, mapUVToCell } from './layout'
import { getRenderer } from './renderer'
import {
  createGameCamera,
  createGameTexture,
  createGameMaterial,
  createGameScene,
  createGameMesh,
} from './setup'

export interface Scene3DHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
}

interface Scene3DProps {
  board: BoardNode
  activeConstraint: number[]
  currentPlayer: Player
  winner: Winner
  onMove: (x: number, y: number) => void
  statsInstance: Stats | null
  depth: number
  initialReset?: boolean
}

// --- Texture Helper ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fillTextureBuffer = (data: any, board: BoardNode, depth: number) => {
  const size = BOARD_SIZE * BOARD_SIZE
  // Reset
  for (let i = 0; i < size * 4; i++) data[i] = 0

  const traverse = (
    node: BoardNode,
    x: number,
    y: number,
    currentDepth: number
  ) => {
    // 1. Mark Leaf
    if (currentDepth === 0) {
      if (node.value) {
        const idx = (y * BOARD_SIZE + x) * 4
        // r channel uses 0..1 range. 0.3 for X, 0.7 for O
        data[idx] = node.value === 'X' ? 0.3 : 0.7
      }
      return
    }

    // 2. Mark Node Winner/Value
    const val = node.winner || node.value
    if (val) {
      // Flood fill this node's area in the appropriate channel
      // We map depth to channel.
      // Leaf (depth 0) -> R (channel 0)
      // Depth 1 -> G (channel 1)
      // Depth 2 -> B (channel 2)
      // Depth 3 -> A (channel 3)

      const channel = currentDepth
      const floatVal =
        (val === 'X' ? 0.3 : 0.7) +
        (node.winPattern >= 0 ? 0.02 * node.winPattern : 0)

      const startX = x
      const startY = y
      const dim = Math.pow(3, currentDepth)

      for (let dy = 0; dy < dim; dy++) {
        for (let dx = 0; dx < dim; dx++) {
          const px = startX + dx
          const py = startY + dy
          if (px < BOARD_SIZE && py < BOARD_SIZE) {
            const idx = (py * BOARD_SIZE + px) * 4
            data[idx + channel] = floatVal
          }
        }
      }
    }

    if (node.children) {
      const childSize = Math.pow(3, currentDepth - 1)
      for (let i = 0; i < 9; i++) {
        const childNode = node.children[i]
        const cx = x + (i % 3) * childSize
        const cy = y + Math.floor(i / 3) * childSize
        traverse(childNode, cx, cy, currentDepth - 1)
      }
    }
  }

  traverse(board, 0, 0, depth)
}

// HMR Persistence
let persistedZoom = 0.9
let persistedPan = { x: 0, y: 0 }

export const Scene3D = ({
  board,
  activeConstraint,
  currentPlayer,
  winner,
  onMove,
  statsInstance,
  depth,
  initialReset,
  ref,
}: Scene3DProps & { ref?: React.Ref<Scene3DHandle> }) => {
  // ... (refs)
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<OrthographicCamera | null>(null)
  const materialRef = useRef<ShaderMaterial | null>(null)
  const textureRef = useRef<DataTexture | null>(null)
  const isDragging = useRef(false)
  const isHovering = useRef(true)
  const dragStartPos = useRef({ x: 0, y: 0 })
  const lastMousePosition = useRef({ x: 0, y: 0 })
  const zoomLevel = useRef(initialReset ? 0.9 : persistedZoom)
  const panOffset = useRef(initialReset ? { x: 0, y: 0 } : persistedPan)
  const gameOverRef = useRef(false)
  const [cursorClass, setCursorClass] = useState('cursor-default')

  // Cache canvas size to avoid reflows in input handlers
  const canvasSize = useRef({ w: 1, h: 1 })
  // Cache Frustum Size to avoid recalculation
  const frustumSize = useRef({ w: 1, h: 1 })

  // Smooth Transition State
  const playerValRef = useRef(currentPlayer === 'X' ? 0 : 1)
  const targetPlayerValRef = useRef(currentPlayer === 'X' ? 0 : 1)

  // Touch State
  const touchStartDist = useRef(0)
  const touchStartZoom = useRef(0)

  // --- Interaction Helpers ---
  const getFrustumSize = (aspect: number, zoom: number) => {
    if (aspect >= 1) {
      return { w: aspect / zoom, h: 1.0 / zoom }
    } else {
      return { w: 1.0 / zoom, h: 1.0 / aspect / zoom }
    }
  }

  const updateCamera = useCallback(() => {
    if (!cameraRef.current) return
    const { w, h } = canvasSize.current
    const aspect = w / h
    const zoom = zoomLevel.current

    const { w: frusW, h: frusH } = getFrustumSize(aspect, zoom)
    frustumSize.current = { w: frusW, h: frusH }

    const px = panOffset.current.x
    const py = panOffset.current.y

    cameraRef.current.left = -frusW + px
    cameraRef.current.right = frusW + px
    cameraRef.current.top = frusH + py
    cameraRef.current.bottom = -frusH + py
    cameraRef.current.updateProjectionMatrix()
  }, [])

  // Helper for max zoom
  const getMaxZoom = () => Math.pow(3, depth - 1)

  // Expose Controls
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const maxZoom = getMaxZoom()
      const newZoom = Math.min(zoomLevel.current * 1.2, maxZoom)
      zoomLevel.current = newZoom
      persistedZoom = newZoom
      updateCamera()
    },
    zoomOut: () => {
      const newZoom = Math.max(zoomLevel.current / 1.2, 0.5)
      zoomLevel.current = newZoom
      persistedZoom = newZoom
      updateCamera()
    },
    resetView: () => {
      zoomLevel.current = 0.9
      panOffset.current = { x: 0, y: 0 }
      persistedZoom = 0.9
      persistedPan = { x: 0, y: 0 }
      updateCamera()
    },
  }))

  // --- Board State to Texture ---
  // Update input timestamp when board/winner changes to ensure specific frames are rendered
  // (Fixes issue where AI wins while user is idle, and renderer sleeps before showing final move)
  useEffect(() => {
    lastActivityRef.current = performance.now()
  }, [board, winner])

  const lastActivityRef = useRef(0)

  const updateTexture = useCallback(() => {
    if (!textureRef.current || !board) return

    const data = textureRef.current.image.data
    if (!data) return

    fillTextureBuffer(data, board, depth)
    textureRef.current.needsUpdate = true
  }, [board, depth])

  // Capture initial props for one-time setup to avoid dependency cycle in useLayoutEffect
  const setupProps = useRef({ activeConstraint, currentPlayer, depth, board })

  // --- Initialization ---
  // Use useLayoutEffect to attach renderer BEFORE paint
  useLayoutEffect(() => {
    if (!mountRef.current) return

    // Renderer
    // Use Singleton Renderer to ensure shader cache sharing with prewarm
    const renderer = getRenderer()

    // Ensure we are attached
    if (!mountRef.current.contains(renderer.domElement)) {
      // If checking fails, just append.
      // Better: clear first?
      mountRef.current.innerHTML = ''
      mountRef.current.appendChild(renderer.domElement)
    }

    // Update size immediately
    renderer.setSize(window.innerWidth, window.innerHeight)
    rendererRef.current = renderer

    // Scene & Cam
    const scene = createGameScene()
    sceneRef.current = scene
    const camera = createGameCamera()
    cameraRef.current = camera

    // State Texture
    const texture = createGameTexture()
    textureRef.current = texture

    // Material
    // Use captured props for initial setup
    const {
      activeConstraint: initConstraint,
      currentPlayer: initPlayer,
      depth: initDepth,
    } = setupProps.current
    const initialPlayerVal = initPlayer === 'X' ? 0 : 1
    const initialConstraintRect = getConstraintRect(initConstraint, initDepth)
    const material = createGameMaterial(
      texture,
      initDepth,
      initialPlayerVal,
      initialConstraintRect
    )
    materialRef.current = material
    playerValRef.current = initialPlayerVal // Sync ref too

    // Geometry
    const { mesh, geometry } = createGameMesh(material)
    scene.add(mesh)

    // --- SYNCHRONOUS INITIAL RENDER (Fix Stale Frame) ---
    // 1. Fill Texture (using captured board)
    if (setupProps.current.board && texture.image.data) {
      fillTextureBuffer(texture.image.data, setupProps.current.board, initDepth)
      texture.needsUpdate = true
    }

    // 2. Set Camera
    // Ensure camera is updated based on current dims
    if (mountRef.current) {
      const w = mountRef.current.clientWidth
      const h = mountRef.current.clientHeight
      renderer.setSize(w, h) // Just in case

      // Correct Aspect
      const aspect = w / h
      const zoom = zoomLevel.current // Already reset if initialReset is true

      // Update Projection Ref manually without calling local updateCamera yet
      const { w: frusW, h: frusH } = getFrustumSize(aspect, zoom)
      const px = panOffset.current.x
      const py = panOffset.current.y

      camera.left = -frusW + px
      camera.right = frusW + px
      camera.top = frusH + py
      camera.bottom = -frusH + py
      camera.updateProjectionMatrix()
    }

    // 3. Render
    renderer.render(scene, camera)

    // Loop Logic
    let lastTime = performance.now()
    let animationId: number

    const handleInput = () => {
      lastActivityRef.current = performance.now()
    }

    const handleEnter = () => {
      isHovering.current = true
    }
    const handleLeave = () => {
      isHovering.current = false
    }

    window.addEventListener('pointermove', handleInput)
    window.addEventListener('wheel', handleInput)
    window.addEventListener('pointerdown', handleInput)
    window.addEventListener('keydown', handleInput)
    document.body.addEventListener('pointerenter', handleEnter)
    document.body.addEventListener('pointerleave', handleLeave)

    const renderFrame = (t: number, dt: number) => {
      material.uniforms.uTime.value = t * 0.001

      // Animate Constraint & Player Color (Synced Decay)
      const decay = 15.0 // Adjustable speed
      const alpha = 1.0 - Math.exp(-decay * dt)

      // Animate Player Color Transition
      playerValRef.current = MathUtils.lerp(
        playerValRef.current,
        targetPlayerValRef.current,
        alpha
      )
      material.uniforms.uPlayer.value = playerValRef.current

      // Animate Constraint

      constraintRef.current.lerp(targetConstraintRef.current, alpha)

      // Snap if close enough (Manual Manhattan distance)
      const d =
        Math.abs(constraintRef.current.x - targetConstraintRef.current.x) +
        Math.abs(constraintRef.current.y - targetConstraintRef.current.y) +
        Math.abs(constraintRef.current.z - targetConstraintRef.current.z) +
        Math.abs(constraintRef.current.w - targetConstraintRef.current.w)

      if (d < 0.001) {
        constraintRef.current.copy(targetConstraintRef.current)
      }
      material.uniforms.uConstraint.value.copy(constraintRef.current)

      renderer.render(scene, camera)
    }

    const animate = (time: number) => {
      animationId = requestAnimationFrame(animate)

      // 1. Background / Inactive Tab Check
      if (document.hidden) {
        return
      }

      // Limit to 10 FPS ONLY if Unfocused AND Not Hovering
      if (!document.hasFocus() && !isHovering.current) {
        const bgInterval = 100 // 10 FPS
        const delta = time - lastTime

        if (delta > bgInterval) {
          const dt = Math.min(delta / 1000, 0.1)
          lastTime = time - (delta % bgInterval)
          statsInstance?.begin()
          renderFrame(time, dt)
          statsInstance?.end()
        }
        return
      }

      // 2. Dragging (Highest Priority) - Uncapped VSync
      if (isDragging.current) {
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        statsInstance?.begin()
        renderFrame(time, dt)
        statsInstance?.end()
        lastTime = time
        return
      }

      // 3. Dynamic FPS (Active vs Idle vs Game Over)
      // Use gameOverRef to avoid stale closure issues in the animation loop
      const currentState = !!gameOverRef.current
      const isActive = time - lastActivityRef.current < 2000

      if (currentState) {
        // Game Over Mode: Only render if active (recent interaction)

        if (isActive) {
          const dt = Math.min((time - lastTime) / 1000, 0.1)
          statsInstance?.begin()
          renderFrame(time, dt)
          statsInstance?.end()
          lastTime = time
        } else {
          // Idle in Game Over: Sleep completely, check periodically for wake-up
          const checkInterval = 200
          if (time - lastTime > checkInterval) {
            lastTime = time // Tick to avoid huge dt spike
          }
        }
      } else if (isActive) {
        // Active: Uncapped (VSync Limit)
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        statsInstance?.begin()
        renderFrame(time, dt)
        statsInstance?.end()
        lastTime = time
      } else {
        // Idle: Throttled to 48 FPS to save power
        const targetFPS = 48
        const interval = 1000 / targetFPS
        const delta = time - lastTime

        if (delta > interval) {
          const dt = Math.min(delta / 1000, 0.1)
          lastTime = time - (delta % interval)
          statsInstance?.begin()
          renderFrame(time, dt)
          statsInstance?.end()
        }
      }
    }
    animationId = requestAnimationFrame(animate)

    // Resize logic using ResizeObserver
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current) return

      const w = mountRef.current.clientWidth
      const h = mountRef.current.clientHeight

      canvasSize.current = { w, h }

      renderer.setSize(w, h)
      updateCamera()
    }

    // Initial Resize
    handleResize()

    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })

    if (mountRef.current) {
      resizeObserver.observe(mountRef.current)
    }

    // Clean up
    const node = mountRef.current
    return () => {
      cancelAnimationFrame(animationId)
      resizeObserver.disconnect()

      window.removeEventListener('pointermove', handleInput)
      window.removeEventListener('wheel', handleInput)
      window.removeEventListener('pointerdown', handleInput)
      window.removeEventListener('keydown', handleInput)
      document.body.removeEventListener('pointerenter', handleEnter)
      document.body.removeEventListener('pointerleave', handleLeave)

      // DO NOT dispose renderer (Singleton).
      // Just remove from DOM.
      if (node && renderer.domElement) {
        if (node.contains(renderer.domElement)) {
          node.removeChild(renderer.domElement)
        }
      }

      // Dispose scene resources
      texture.dispose()
      material.dispose()
      geometry.dispose()
    }
  }, [updateCamera, statsInstance])
  useEffect(() => {
    updateTexture()
  }, [updateTexture, board])

  // Constraint Animation State
  const initialRect = getConstraintRect(activeConstraint, depth)
  const constraintRef = useRef(
    new Vector4(initialRect.x, initialRect.y, initialRect.w, initialRect.h)
  )
  const targetConstraintRef = useRef(
    new Vector4(initialRect.x, initialRect.y, initialRect.w, initialRect.h)
  )

  useEffect(() => {
    if (materialRef.current) {
      let rect = getConstraintRect(activeConstraint, depth)

      // If game is over (winner exists), hide the constraint glow.
      // Also update the uGameOver uniform.
      if (winner) {
        rect = { x: 0, y: 0, w: 0, h: 0 }
        materialRef.current.uniforms.uGameOver.value = 1
        gameOverRef.current = true
      } else {
        materialRef.current.uniforms.uGameOver.value = 0
        gameOverRef.current = false
      }

      targetConstraintRef.current.set(rect.x, rect.y, rect.w, rect.h)

      // Also update depth uniform!
      materialRef.current.uniforms.uDepth.value = depth

      // Update Constraint Level (Len)
      // If constraint is empty, level is 0? Or doesn't matter as w=0.
      materialRef.current.uniforms.uConstraintLevel.value =
        activeConstraint.length

      const target = currentPlayer === 'X' ? 0 : 1
      targetPlayerValRef.current = target
    }
  }, [activeConstraint, currentPlayer, depth, winner])

  const getUV = (e: React.MouseEvent | MouseEvent | { clientX: number, clientY: number }) => {
    if (!rendererRef.current) return { x: -1, y: -1 }
    const rect = rendererRef.current.domElement.getBoundingClientRect()
    // Normalized Device Coordinates (-1 to 1)
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const { w: frusW, h: frusH } = frustumSize.current

    const worldX = ndcX * frusW + panOffset.current.x
    const worldY = ndcY * frusH + panOffset.current.y

    // UV 0 is at -1, UV 1 is at 1.
    const uvX = (worldX + 1) / 2
    const uvY = (worldY + 1) / 2

    return { x: uvX, y: uvY }
  }

  // --- Event Handlers ---
  const handleWheel = (e: React.WheelEvent) => {
    if (!rendererRef.current) return

    // Calculate mouse position relative to center (NDC-like but scaling with aspect)
    const rect = rendererRef.current.domElement.getBoundingClientRect()
    // NDC (-1 to 1)
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const { w, h } = canvasSize.current
    const aspect = w / h

    // Current World Position of mouse
    const oldZoom = zoomLevel.current
    // Use cached frustum size if available, but for wheel we need strictly synced with oldZoom
    // Just recalculate to be safe as zoom changes
    const { w: oldFrusW, h: oldFrusH } = getFrustumSize(aspect, oldZoom)

    const mouseWorldX = ndcX * oldFrusW + panOffset.current.x
    const mouseWorldY = ndcY * oldFrusH + panOffset.current.y

    const factor = 1.1
    let newZoom = oldZoom
    if (e.deltaY < 0) newZoom *= factor
    else newZoom /= factor

    const maxZoom = getMaxZoom()
    newZoom = Math.min(Math.max(newZoom, 0.5), maxZoom)
    zoomLevel.current = newZoom
    persistedZoom = newZoom

    // Calculate new Pan Offset to keep mouseWorldX at same NDC
    const { w: newFrusW, h: newFrusH } = getFrustumSize(aspect, newZoom)

    panOffset.current.x = mouseWorldX - ndcX * newFrusW
    panOffset.current.y = mouseWorldY - ndcY * newFrusH
    persistedPan = { ...panOffset.current }

    updateCamera()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow Left (0) or Middle (1) to start interaction
    if (e.button !== 0 && e.button !== 1) return

    isDragging.current = false // Start assumption: Click
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    lastMousePosition.current = { x: e.clientX, y: e.clientY }
    setCursorClass('cursor-grabbing')
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    // Pan Logic
    // Pan Logic (Left=1, Middle=4 in e.buttons)
    if (e.buttons & 1 || e.buttons & 4) {
      const dx = e.clientX - lastMousePosition.current.x
      const dy = e.clientY - lastMousePosition.current.y

      // Check for drag threshold if not yet dragging
      if (!isDragging.current) {
        const moveDist = Math.hypot(
          e.clientX - dragStartPos.current.x,
          e.clientY - dragStartPos.current.y
        )
        if (moveDist > 5) isDragging.current = true
      }

      if (isDragging.current) {
        lastMousePosition.current = { x: e.clientX, y: e.clientY }

        const { w, h } = canvasSize.current
        // const aspect = w / h

        const { w: frusW, h: frusH } = frustumSize.current

        // frusW is half-width (left to 0). Total width is 2*frusW.
        const worldWidth = 2 * frusW
        const worldHeight = 2 * frusH

        panOffset.current.x -= (dx / w) * worldWidth
        panOffset.current.y += (dy / h) * worldHeight
        // eslint-disable-next-line
        persistedPan = { ...panOffset.current }

        updateCamera()
        return
      }
      // Block hover logic if button down but not dragging
      return
    } else {
      // If button not held but we thought we were dragging (e.g. out of window release), reset
      if (isDragging.current) isDragging.current = false
    }

    // Hover Logic
    const uv = getUV(e)
    if (!materialRef.current) return

    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      const mapped = mapUVToCell(uv, depth)
      if (mapped.valid) {
        // Use array assignment for ivec2
        const h = materialRef.current.uniforms.uHover.value
        h[0] = mapped.x
        h[1] = mapped.y

        // Cursor Logic
        if (
          activeConstraint.length === 0 ||
          isInsideConstraint(uv, activeConstraint)
        ) {
          setCursorClass('cursor-crosshair')
        } else {
          // Only show "not-allowed" if trying to interact (button down)
          if (e.buttons !== 0) setCursorClass('cursor-not-allowed')
          else setCursorClass('cursor-default')
        }
      } else {
        const h = materialRef.current.uniforms.uHover.value
        h[0] = -1
        h[1] = -1
        setCursorClass('cursor-default')
      }
    } else {
      const h = materialRef.current.uniforms.uHover.value
      h[0] = -1
      h[1] = -1
      setCursorClass('cursor-default')
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current && e.button === 0) {
      // Click
      const uv = getUV(e)
      if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
        const mapped = mapUVToCell(uv, depth)
        if (mapped.valid) {
          onMove(mapped.x, mapped.y)
        }
      }
    }
    isDragging.current = false
    // Trigger hover update to restore cursor
    handleMouseMove(e)
  }

  // --- Touch Handlers ---
  const handleTouchStart = (e: React.TouchEvent) => {
    // e.preventDefault(); // Controlled via CSS/Meta for now to avoid React passive issues

    if (e.touches.length === 1) {
      isDragging.current = false // Wait for move
      dragStartPos.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      }
      lastMousePosition.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      }
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0]
      const t1 = e.touches[1]
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)
      touchStartDist.current = dist
      touchStartZoom.current = zoomLevel.current

      lastMousePosition.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t0 = e.touches[0]
      const dx = t0.clientX - lastMousePosition.current.x
      const dy = t0.clientY - lastMousePosition.current.y

      if (!isDragging.current) {
        const moveDist = Math.hypot(
          t0.clientX - dragStartPos.current.x,
          t0.clientY - dragStartPos.current.y
        )
        if (moveDist > 5) isDragging.current = true
      }

      if (isDragging.current) {
        // Apply Pan
        const { w, h } = canvasSize.current
        const { w: frusW, h: frusH } = frustumSize.current

        panOffset.current.x -= (dx / w) * (2 * frusW)
        panOffset.current.y += (dy / h) * (2 * frusH)

        lastMousePosition.current = { x: t0.clientX, y: t0.clientY }
        updateCamera()
      }
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0]
      const t1 = e.touches[1]
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)

      // Zoom
      if (touchStartDist.current > 0) {
        const scale = dist / touchStartDist.current
        let newZoom = touchStartZoom.current * scale
        const maxZoom = getMaxZoom()
        newZoom = Math.min(Math.max(newZoom, 0.5), maxZoom)
        zoomLevel.current = newZoom
        persistedZoom = newZoom
      }

      // Pan (Pinch center move)
      const cx = (t0.clientX + t1.clientX) / 2
      const cy = (t0.clientY + t1.clientY) / 2
      const dx = cx - lastMousePosition.current.x
      const dy = cy - lastMousePosition.current.y

      const { w, h } = canvasSize.current
      // const aspect = w / h
      const { w: frusW, h: frusH } = frustumSize.current

      // Inverse pan logic
      panOffset.current.x -= (dx / w) * (2 * frusW)
      panOffset.current.y += (dy / h) * (2 * frusH)

      lastMousePosition.current = { x: cx, y: cy }
      updateCamera()
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (
      !isDragging.current &&
      e.changedTouches.length > 0 &&
      e.touches.length === 0
    ) {
      // Tap (Touch Click)
      // Emulate click by creating a fake event-like object for getUV
      const t0 = e.changedTouches[0]
      // We need clientX/Y. getUV uses e.clientX directly.
      // We can construct a minimal object that getUV accepts.
      const fakeEvent = {
        clientX: t0.clientX,
        clientY: t0.clientY,
      }

      const uv = getUV(fakeEvent)
      if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
        const mapped = mapUVToCell(uv, depth)
        if (mapped.valid) {
          onMove(mapped.x, mapped.y)
        }
      }
    }

    if (e.touches.length === 0) {
      isDragging.current = false
    } else if (e.touches.length === 1) {
      // If going from 2 -> 1, reset last position to avoid jumps
      lastMousePosition.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      }
    }
  }

  useEffect(() => {
    const onUp = () => {
      isDragging.current = false
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  const isInsideConstraint = (
    uv: { x: number; y: number },
    constraint: number[]
  ) => {
    const rect = getConstraintRect(constraint, depth)
    return (
      uv.x >= rect.x &&
      uv.x <= rect.x + rect.w &&
      uv.y >= rect.y &&
      uv.y <= rect.y + rect.h
    )
  }

  // Initial Camera Update
  useEffect(() => {
    setTimeout(updateCamera, 0)
  }, [updateCamera])

  return (
    <div className='h-dvh w-screen bg-black overflow-hidden relative'>
      <div
        ref={mountRef}
        className={`w-full h-full ${cursorClass}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
