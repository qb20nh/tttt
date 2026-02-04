import { createContext, use } from 'react'
import type { RouterContextValue } from './types'

/**
 * Router context - provides navigation and route state
 */
export const RouterContext = createContext<RouterContextValue | null>(null)

/**
 * Hook to access router navigation and state
 * @throws Error if used outside RouterProvider
 */
export function useRouter (): RouterContextValue {
  const context = use(RouterContext)
  if (!context) {
    throw new Error('useRouter must be used within a Router component')
  }
  return context
}

/**
 * Hook to access current route params
 */
export function useParams<T = Record<string, string>> (): T {
  const { route } = useRouter()
  return (route?.params ?? {}) as T
}

/**
 * Hook to get navigate function only
 */
export function useNavigate (): (path: string) => void {
  const { navigate } = useRouter()
  return navigate
}
