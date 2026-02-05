import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type Stats from 'stats.js'
import type { BoardNode, Player, Winner } from '../game/types'
import {
  BOARD_SIZE,
  DEFAULT_VIEW_SCALE,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
} from '../game/constants'
import { getPathFromCoordinates, isValidPath } from '../game/logic'
import { getConstraintRect, mapUVToCell } from './layout'
import { fillBoardTexture } from './boardTexture'
import { getRenderer, requestRendererCompile } from './renderer'
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
  onMove: (gridX: number, gridY: number) => void
  statsInstance: Stats | null
  depth: number
  initialReset: boolean
}

export const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(({
  board,
  activeConstraint,
  currentPlayer,
  winner,
  onMove,
  statsInstance,
  depth,
  initialReset,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<ReturnType<typeof getRenderer> | null>(null)
  const rendererErrorRef = useRef<unknown | null>(null)
  const fallbackRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)
  const textureDataRef = useRef<Float32Array | Uint8Array | null>(null)
  const needsTextureUpdateRef = useRef(true)

  const viewRef = useRef({ scale: DEFAULT_VIEW_SCALE, offsetX: 0, offsetY: 0 })
  const hoverRef = useRef({ x: -1, y: -1 })
  const constraintRef = useRef({ x: 0, y: 0, w: 0, h: 0, level: 0 })
  const projectionRef = useRef({ x: 1, y: 1 })
  const lastTimeRef = useRef(0)
  const playerRef = useRef(currentPlayer === 'X' ? 0 : 1)
  const gameOverRef = useRef(winner ? 1 : 0)
  const constraintDisplayRef = useRef({ x: 0, y: 0, w: 0, h: 0, level: 0 })

  const pointerRef = useRef({
    isDragging: false,
    pointerId: -1,
    moved: false,
    forcePan: false,
    pointerType: 'mouse',
    lastX: 0,
    lastY: 0,
  })
  const pinchRef = useRef({
    active: false,
    distance: 0,
    centerX: 0,
    centerY: 0,
  })
  const pointersRef = useRef(
    new Map<number, { x: number; y: number; type: string }>()
  )
  const suppressClickRef = useRef(false)

  const stateRef = useRef({
    board,
    activeConstraint,
    currentPlayer,
    winner,
    depth,
  })

  const onMoveRef = useRef(onMove)
  const statsRef = useRef<Stats | null>(statsInstance)

  useEffect(() => {
    stateRef.current = {
      board,
      activeConstraint,
      currentPlayer,
      winner,
      depth,
    }
  }, [board, activeConstraint, currentPlayer, winner, depth])

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    statsRef.current = statsInstance
  }, [statsInstance])

  useEffect(() => {
    needsTextureUpdateRef.current = true
  }, [board, depth])

  useEffect(() => {
    const rect = getConstraintRect(activeConstraint, depth)
    constraintRef.current = {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      level: activeConstraint.length,
    }
  }, [activeConstraint, depth])

  useEffect(() => {
    hoverRef.current = { x: -1, y: -1 }
  }, [activeConstraint, board, winner, depth])

  const applyView = useCallback(() => {
    const view = viewRef.current
    // Allow panning until board edge/corner touches screen edge/corner
    const maxOffset = view.scale + 1
    view.offsetX = Math.max(-maxOffset, Math.min(maxOffset, view.offsetX))
    view.offsetY = Math.max(-maxOffset, Math.min(maxOffset, view.offsetY))
    rendererRef.current?.setView(view.scale, view.offsetX, view.offsetY)
  }, [])

  const resetView = useCallback(() => {
    viewRef.current = { scale: DEFAULT_VIEW_SCALE, offsetX: 0, offsetY: 0 }
    applyView()
  }, [applyView])

  const zoomAt = useCallback((factor: number, ndcX: number, ndcY: number) => {
    const projection = projectionRef.current
    const viewNdcX = projection.x !== 0 ? ndcX / projection.x : ndcX
    const viewNdcY = projection.y !== 0 ? ndcY / projection.y : ndcY
    const view = viewRef.current
    const currentScale = view.scale
    const nextScale = Math.max(
      MIN_VIEW_SCALE,
      Math.min(MAX_VIEW_SCALE, currentScale * factor)
    )
    if (nextScale === currentScale) return

    const uvX = ((viewNdcX - view.offsetX) / currentScale + 1) * 0.5
    const uvY = ((viewNdcY - view.offsetY) / currentScale + 1) * 0.5

    view.scale = nextScale
    view.offsetX = viewNdcX - (uvX * 2 - 1) * nextScale
    view.offsetY = viewNdcY - (uvY * 2 - 1) * nextScale

    applyView()
  }, [applyView])

  const zoomIn = useCallback(() => {
    zoomAt(1.2, 0, 0)
  }, [zoomAt])

  const zoomOut = useCallback(() => {
    zoomAt(1 / 1.2, 0, 0)
  }, [zoomAt])

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, resetView }), [
    zoomIn,
    zoomOut,
    resetView,
  ])

  useEffect(() => {
    if (initialReset) {
      resetView()
    }
  }, [initialReset, resetView])

  useEffect(() => {
    if (!containerRef.current) return
    requestRendererCompile()
    if (!rendererRef.current && rendererErrorRef.current === null) {
      try {
        rendererRef.current = getRenderer()
      } catch (error) {
        rendererErrorRef.current = error
      }
    }

    const renderer = rendererRef.current
    if (!renderer) {
      if (rendererErrorRef.current) {
        console.error(rendererErrorRef.current)
      }
      if (fallbackRef.current) {
        fallbackRef.current.style.display = 'flex'
      }
      return
    }
    if (fallbackRef.current) {
      fallbackRef.current.style.display = 'none'
    }

    const container = containerRef.current
    const canvas = renderer.canvas
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    canvas.style.cursor = 'crosshair'

    if (!canvas.parentElement) {
      container.appendChild(canvas)
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setSize(rect.width, rect.height, pixelRatio)
      const aspect = rect.width / rect.height
      let scaleX = 1
      let scaleY = 1
      if (aspect > 1) {
        scaleX = rect.height / rect.width
      } else if (aspect > 0) {
        scaleY = rect.width / rect.height
      }
      projectionRef.current = { x: scaleX, y: scaleY }
      renderer.setProjection(scaleX, scaleY)
    }

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (observer) {
      observer.observe(container)
    } else {
      window.addEventListener('resize', resize)
    }
    resize()
    applyView()

    const getNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = 1 - ((clientY - rect.top) / rect.height) * 2
      return { x, y }
    }

    const ndcToUv = (ndcX: number, ndcY: number) => {
      const projection = projectionRef.current
      const viewNdcX = projection.x !== 0 ? ndcX / projection.x : ndcX
      const viewNdcY = projection.y !== 0 ? ndcY / projection.y : ndcY
      const view = viewRef.current
      return {
        x: ((viewNdcX - view.offsetX) / view.scale + 1) * 0.5,
        y: ((viewNdcY - view.offsetY) / view.scale + 1) * 0.5,
      }
    }

    const updateHover = (clientX: number, clientY: number) => {
      const { x: ndcX, y: ndcY } = getNdc(clientX, clientY)
      const uv = ndcToUv(ndcX, ndcY)
      const cell = mapUVToCell(uv, stateRef.current.depth)
      if (!cell.valid) {
        hoverRef.current = { x: -1, y: -1 }
        return
      }

      const isPlayable = () => {
        const { board, activeConstraint, depth, winner } = stateRef.current
        if (winner) return false
        const path = getPathFromCoordinates(cell.x, cell.y, depth)
        if (activeConstraint.length > 0) {
          for (let i = 0; i < activeConstraint.length; i++) {
            if (activeConstraint[i] !== path[i]) return false
          }
        }
        return isValidPath(board, path)
      }

      if (!isPlayable()) {
        hoverRef.current = { x: -1, y: -1 }
        return
      }

      hoverRef.current = { x: cell.x, y: cell.y }
    }

    const startDrag = (event: PointerEvent, forcePan: boolean) => {
      pointerRef.current.isDragging = true
      pointerRef.current.pointerId = event.pointerId
      pointerRef.current.lastX = event.clientX
      pointerRef.current.lastY = event.clientY
      pointerRef.current.moved = false
      pointerRef.current.forcePan = forcePan
      pointerRef.current.pointerType = event.pointerType
      if (forcePan) {
        suppressClickRef.current = true
        hoverRef.current = { x: -1, y: -1 }
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        event.preventDefault()
      }

      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        type: event.pointerType,
      })

      if (event.pointerType === 'touch') {
        if (pointersRef.current.size === 1) {
          startDrag(event, false)
        } else if (pointersRef.current.size === 2) {
          const [first, second] = Array.from(
            pointersRef.current.values()
          )
          const centerX = (first.x + second.x) * 0.5
          const centerY = (first.y + second.y) * 0.5
          const dx = first.x - second.x
          const dy = first.y - second.y
          pinchRef.current.active = true
          pinchRef.current.distance = Math.hypot(dx, dy)
          pinchRef.current.centerX = centerX
          pinchRef.current.centerY = centerY
          pointerRef.current.isDragging = false
          suppressClickRef.current = true
          hoverRef.current = { x: -1, y: -1 }
        }
      } else {
        const isPanButton = event.button === 2 || event.button === 1
        startDrag(event, isPanButton)
      }

      canvas.setPointerCapture(event.pointerId)
    }

    const applyPan = (dx: number, dy: number) => {
      const rect = canvas.getBoundingClientRect()
      const ndcDx = (dx / rect.width) * 2
      const ndcDy = (-dy / rect.height) * 2
      const projection = projectionRef.current
      const viewDx = projection.x !== 0 ? ndcDx / projection.x : ndcDx
      const viewDy = projection.y !== 0 ? ndcDy / projection.y : ndcDy

      viewRef.current.offsetX += viewDx
      viewRef.current.offsetY += viewDy
      applyView()
    }

    const handlePointerMove = (event: PointerEvent) => {
      const pointer = pointersRef.current.get(event.pointerId)
      if (pointer) {
        pointer.x = event.clientX
        pointer.y = event.clientY
      }

      if (pointersRef.current.size >= 2 && pinchRef.current.active) {
        const [first, second] = Array.from(
          pointersRef.current.values()
        )
        const centerX = (first.x + second.x) * 0.5
        const centerY = (first.y + second.y) * 0.5
        const dx = first.x - second.x
        const dy = first.y - second.y
        const distance = Math.hypot(dx, dy)

        const centerDx = centerX - pinchRef.current.centerX
        const centerDy = centerY - pinchRef.current.centerY
        if (Math.abs(centerDx) + Math.abs(centerDy) > 0) {
          applyPan(centerDx, centerDy)
        }

        if (pinchRef.current.distance > 0 && distance > 0) {
          const zoomFactor = distance / pinchRef.current.distance
          const { x: ndcX, y: ndcY } = getNdc(centerX, centerY)
          zoomAt(zoomFactor, ndcX, ndcY)
        }

        pinchRef.current.distance = distance
        pinchRef.current.centerX = centerX
        pinchRef.current.centerY = centerY
        pointerRef.current.moved = true
        return
      }

      if (
        pointerRef.current.isDragging &&
        pointerRef.current.pointerId === event.pointerId
      ) {
        const dx = event.clientX - pointerRef.current.lastX
        const dy = event.clientY - pointerRef.current.lastY
        pointerRef.current.lastX = event.clientX
        pointerRef.current.lastY = event.clientY

        if (
          !pointerRef.current.moved &&
          Math.hypot(dx, dy) > 4
        ) {
          pointerRef.current.moved = true
          suppressClickRef.current = true
          hoverRef.current = { x: -1, y: -1 }
        }

        if (pointerRef.current.forcePan || pointerRef.current.moved) {
          applyPan(dx, dy)
          return
        }
      }

      if (event.pointerType === 'mouse') {
        updateHover(event.clientX, event.clientY)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      pointersRef.current.delete(event.pointerId)

      if (pointersRef.current.size < 2) {
        pinchRef.current.active = false
        pinchRef.current.distance = 0
      }

      const wasDragging =
        pointerRef.current.isDragging &&
        pointerRef.current.pointerId === event.pointerId

      const shouldClick =
        wasDragging &&
        !pointerRef.current.forcePan &&
        !pointerRef.current.moved &&
        !suppressClickRef.current

      if (wasDragging) {
        pointerRef.current.isDragging = false
        pointerRef.current.pointerId = -1
        pointerRef.current.moved = false
        pointerRef.current.forcePan = false
      }

      if (pointersRef.current.size === 0) {
        suppressClickRef.current = false
      }

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }

      if (shouldClick) {
        updateHover(event.clientX, event.clientY)
        const { x, y } = hoverRef.current
        if (x >= 0 && y >= 0) {
          onMoveRef.current(x, y)
        }
      }
    }

    const handlePointerLeave = () => {
      hoverRef.current = { x: -1, y: -1 }
    }

    const handlePointerCancel = () => {
      pointerRef.current.isDragging = false
      hoverRef.current = { x: -1, y: -1 }
      pinchRef.current.active = false
      pinchRef.current.distance = 0
      pointersRef.current.clear()
      suppressClickRef.current = false
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = -event.deltaY
      const zoomIntensity = 0.0015
      const zoomFactor = Math.exp(delta * zoomIntensity)
      const { x: ndcX, y: ndcY } = getNdc(event.clientX, event.clientY)
      zoomAt(zoomFactor, ndcX, ndcY)
    }

    const handleContextMenu = (event: Event) => {
      event.preventDefault()
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('contextmenu', handleContextMenu)

    const render = (time: number) => {
      const rendererInstance = rendererRef.current
      if (!rendererInstance) return

      const stats = statsRef.current
      if (stats) stats.begin()

      const now = time * 0.001
      const last = lastTimeRef.current || now
      const delta = Math.min(0.05, Math.max(0, now - last))
      lastTimeRef.current = now
      const smooth = 1 - Math.exp(-delta * 8)
      const playerTarget = stateRef.current.currentPlayer === 'X' ? 0 : 1
      playerRef.current += (playerTarget - playerRef.current) * smooth
      const gameOverTarget = stateRef.current.winner ? 1 : 0
      gameOverRef.current += (gameOverTarget - gameOverRef.current) * smooth

      const constraintTarget = constraintRef.current
      const constraintDisplay = constraintDisplayRef.current
      constraintDisplay.x += (constraintTarget.x - constraintDisplay.x) * smooth
      constraintDisplay.y += (constraintTarget.y - constraintDisplay.y) * smooth
      constraintDisplay.w += (constraintTarget.w - constraintDisplay.w) * smooth
      constraintDisplay.h += (constraintTarget.h - constraintDisplay.h) * smooth
      constraintDisplay.level +=
        (constraintTarget.level - constraintDisplay.level) * smooth

      if (needsTextureUpdateRef.current) {
        const scale = rendererInstance.textureScale
        const expectedLength = BOARD_SIZE * BOARD_SIZE * 4
        const existing = textureDataRef.current
        const needsNewBuffer =
          !existing ||
          existing.length !== expectedLength ||
          (rendererInstance.useFloatTexture
            ? !(existing instanceof Float32Array)
            : !(existing instanceof Uint8Array))
        const textureData = needsNewBuffer
          ? new (rendererInstance.useFloatTexture
            ? Float32Array
            : Uint8Array)(expectedLength)
          : existing!
        fillBoardTexture(
          stateRef.current.board,
          stateRef.current.depth,
          textureData,
          scale
        )
        rendererInstance.updateTexture(textureData)
        textureDataRef.current = textureData
        needsTextureUpdateRef.current = false
      }

      const constraint = constraintDisplayRef.current
      rendererInstance.render({
        time: now,
        hover: hoverRef.current,
        constraint: {
          x: constraint.x,
          y: constraint.y,
          w: constraint.w,
          h: constraint.h,
        },
        player: playerRef.current,
        depth: stateRef.current.depth,
        constraintLevel: constraint.level,
        gameOver: gameOverRef.current,
      })

      if (stats) stats.end()

      animationRef.current = requestAnimationFrame(render)
    }

    animationRef.current = requestAnimationFrame(render)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (observer) {
        observer.disconnect()
      } else {
        window.removeEventListener('resize', resize)
      }
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      if (canvas.parentElement === container) {
        container.removeChild(canvas)
      }
    }
  }, [applyView, zoomAt])

  return (
    <>
      <div ref={containerRef} className='absolute inset-0 z-0' />
      <div
        ref={fallbackRef}
        className='absolute inset-0 items-center justify-center text-slate-500'
        style={{ display: 'none' }}
      >
        WebGL2 not supported on this device.
      </div>
    </>
  )
})

Scene3D.displayName = 'Scene3D'
