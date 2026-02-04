/**
 * Preload functions for lazy-loaded components.
 * Call these on hover to eagerly load chunks before navigation.
 */

import { preloadAiWorkers } from '../game/ai/worker-pool'
import { queueShaderPrewarm } from '../graphics/prewarm'

export const preloadGameClient = () => {
  import('./GameClient')
  preloadAiWorkers()
  queueShaderPrewarm()
}

export const preloadHomeScreen = () => {
  import('./HomeScreen')
}
