import { useEffect } from 'react'
import { getRenderer } from './renderer'
import {
  createGameCamera,
  createGameMaterial,
  createGameMesh,
  createGameScene,
  createGameTexture,
} from './setup'

let hasPrewarmed = false
let isPrewarming = false

/**
 * Prewarm shaders during idle time on the main thread.
 */
export const useShaderPrewarm = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (hasPrewarmed || isPrewarming) return

    isPrewarming = true

    // Use requestIdleCallback to trigger during browser idle time
    // Falls back to setTimeout for browsers without support
    const schedulePrewarm = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 1000 })
      } else {
        setTimeout(callback, 50)
      }
    }

    schedulePrewarm(() => {
      try {
        prewarmShaders()
      } catch (error) {
        console.warn('Shader prewarm failed:', error)
        isPrewarming = false
      }
    })
  }, [])
}

const prewarmShaders = () => {
  const renderer = getRenderer()
  const scene = createGameScene()
  const camera = createGameCamera()
  const texture = createGameTexture()
  const material = createGameMaterial(texture, 4)
  const { mesh, geometry } = createGameMesh(material)

  scene.add(mesh)

  const cleanup = () => {
    texture.dispose()
    material.dispose()
    geometry.dispose()
  }

  if (renderer.compileAsync) {
    console.log('Precompiling shaders...')
    renderer
      .compileAsync(scene, camera)
      .then(() => {
        console.log('Successfully precompiled shaders.')
        renderer.render(scene, camera)
        cleanup()
        hasPrewarmed = true
        isPrewarming = false
      })
      .catch((error) => {
        console.warn('Shader prewarm compileAsync failed:', error)
        cleanup()
        isPrewarming = false
      })
    return
  }

  renderer.compile(scene, camera)
  renderer.render(scene, camera)
  cleanup()
  hasPrewarmed = true
  isPrewarming = false
}
