/**
 * Preload functions for lazy-loaded components.
 * Call these on hover to eagerly load chunks before navigation.
 */

import { preloadAiWorkers } from '../game/ai/worker-pool'

export const preloadGameClient = () => {
  import('./GameClient')
  preloadAiWorkers()
}

export const preloadHomeScreen = () => {
  import('./HomeScreen')
}
