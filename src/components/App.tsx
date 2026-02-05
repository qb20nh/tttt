import { lazy } from 'react'
import { Router } from '../router'
import type { RoutesConfig } from '../router'
import { DEFAULT_DEPTH } from '../game/constants'
import type { GameMode } from '../game/types'

interface AppProps {
  initialPath?: string
}

// Lazy load components for code splitting
const HomeScreen = lazy(() =>
  import('./HomeScreen').then((m) => ({ default: m.HomeScreen }))
)
const GameClient = lazy(() =>
  import('./GameClient').then((m) => ({ default: m.GameClient }))
)

// Declarative route configuration
const routes = {
  home: {
    path: '/',
    component: HomeScreen,
  },
  play: {
    path: '/play',
    component: GameClient,
    params: ['mode', 'depth', 'new'],
    defaults: {
      mode: 'PvAI',
      depth: String(DEFAULT_DEPTH),
      new: '0',
    },
  },
} satisfies RoutesConfig

// Parse play route params
function parsePlayParams (params: Record<string, string>) {
  return {
    mode: (params.mode || 'PvAI') as GameMode,
    depth: params.depth ? parseInt(params.depth, 10) : DEFAULT_DEPTH,
    isNewGame: params.new === '1',
  }
}

export const App = ({ initialPath }: AppProps) => {
  return (
    <Router routes={routes} initialPath={initialPath}>
      {({ route, navigate }) => {
        const Component = route.definition.component

        if (route.name === 'home') {
          return <Component onNavigate={navigate} />
        }

        if (route.name === 'play') {
          const { mode, depth, isNewGame } = parsePlayParams(route.params)
          return (
            <Component
              mode={mode}
              depth={depth}
              isNewGame={isNewGame}
              onNavigate={navigate}
            />
          )
        }

        return null
      }}
    </Router>
  )
}
