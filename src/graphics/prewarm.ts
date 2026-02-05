import { getRenderer, requestRendererCompile } from './renderer'
import { BOARD_SIZE, DEFAULT_VIEW_SCALE } from '../game/constants'

let hasPrewarmed = false
let isPrewarming = false

/**
 * Heuristic to avoid prewarming on slow networks/devices.
 * We skip when the device likely prefers saving data or has limited resources.
 */
const shouldSkipPrewarm = () => {
  if (typeof navigator === 'undefined') return true

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection

  if (connection?.saveData) return true
  const effectiveType = connection?.effectiveType
  if (effectiveType && /(?:^|-)2g|3g/.test(effectiveType)) return true

  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory < 4) {
    return true
  }

  const cores = navigator.hardwareConcurrency
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return true

  return false
}

const scheduleAfterLoadIdle = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {}

  let cleanup: (() => void) | null = null

  const runIdle = () => {
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(callback, { timeout: 2000 })
      cleanup = () => {
        if ('cancelIdleCallback' in window) {
          cancelIdleCallback(idleId)
        }
      }
    } else {
      const timeoutId = window.setTimeout(callback, 200)
      cleanup = () => clearTimeout(timeoutId)
    }
  }

  if (document.readyState === 'complete') {
    runIdle()
    return () => cleanup?.()
  }

  const handleLoad = () => {
    runIdle()
  }
  window.addEventListener('load', handleLoad, { once: true })

  return () => {
    window.removeEventListener('load', handleLoad)
    cleanup?.()
  }
}

/**
 * Prewarm shaders during idle time on the main thread.
 * Returns a cleanup function that cancels the scheduled work.
 */
export const queueShaderPrewarm = () => {
  if (typeof window === 'undefined') return () => {}
  if (hasPrewarmed || isPrewarming) return () => {}
  if (shouldSkipPrewarm()) return () => {}

  isPrewarming = true
  let cancelled = false

  const cancelIdle = scheduleAfterLoadIdle(() => {
    if (cancelled) {
      isPrewarming = false
      return
    }
    try {
      prewarmShaders()
    } catch (error) {
      console.warn('Shader prewarm failed:', error)
      isPrewarming = false
    }
  })

  return () => {
    cancelled = true
    cancelIdle()
    if (!hasPrewarmed) {
      isPrewarming = false
    }
  }
}

const prewarmShaders = () => {
  const renderer = getRenderer()
  if (renderer.canvas.isConnected) {
    hasPrewarmed = true
    isPrewarming = false
    return
  }
  requestRendererCompile()

  renderer
    .whenReady()
    .then(() => {
      renderer.setSize(2, 2, 1)
      renderer.setView(DEFAULT_VIEW_SCALE, 0, 0)
      renderer.setProjection(1, 1)

      const data = new (renderer.useFloatTexture
        ? Float32Array
        : Uint8Array)(BOARD_SIZE * BOARD_SIZE * 4)
      renderer.updateTexture(data)

      renderer.render({
        time: 0,
        hover: { x: -1, y: -1 },
        constraint: { x: 0, y: 0, w: 0, h: 0 },
        player: 0,
        depth: 4,
        constraintLevel: 0,
        gameOver: 0,
      })

      hasPrewarmed = true
      isPrewarming = false
    })
    .catch((error) => {
      console.warn('Shader prewarm failed:', error)
      isPrewarming = false
    })
}
