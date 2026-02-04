import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  Suspense,
  type ReactNode,
} from 'react'
import { RouterContext } from './context'
import type { RoutesConfig, MatchedRoute, RouteDefinition } from './types'

interface RouterProps<T extends string> {
  /** Route configuration */
  routes: RoutesConfig<T>
  /** Base URL path (defaults to import.meta.env.BASE_URL) */
  basePath?: string
  /** Fallback while lazy components load */
  fallback?: ReactNode
  /** Render function receiving route, params, and navigate */
  children: (props: {
    route: MatchedRoute
    navigate: (path: string) => void
  }) => ReactNode
}

/**
 * Match current URL against routes
 */
function matchRoute<T extends string> (
  location: Location,
  routes: RoutesConfig<T>,
  basePath: string
): MatchedRoute | null {
  const pathname = location.pathname.replace(/\/$/, '') // Remove trailing slash
  const normalizedBase = basePath.replace(/\/$/, '')

  for (const [name, definition] of Object.entries(routes) as [T, RouteDefinition][]) {
    const routePath = `${normalizedBase}${definition.path}`.replace(/\/$/, '')

    // Check exact match or if path ends with the route path
    if (pathname === routePath || (routePath !== normalizedBase && pathname.endsWith(definition.path.replace(/\/$/, '')))) {
      // Extract query params
      const searchParams = new URLSearchParams(location.search)
      const params: Record<string, string> = {}

      // Apply defaults first
      if (definition.defaults) {
        Object.assign(params, definition.defaults)
      }

      // Override with actual query params
      if (definition.params) {
        for (const param of definition.params) {
          const value = searchParams.get(param)
          if (value !== null) {
            params[param] = value
          }
        }
      }

      return {
        name,
        definition,
        params,
      }
    }
  }

  return null
}

/**
 * Build URL for a route
 */
function buildRouteUrl<T extends string> (
  routeName: string,
  routes: RoutesConfig<T>,
  basePath: string,
  params?: Record<string, string | number | boolean>
): string {
  const definition = routes[routeName as T]
  if (!definition) {
    throw new Error(`Unknown route: ${routeName}`)
  }

  const normalizedBase = basePath.replace(/\/$/, '')
  let url = `${normalizedBase}${definition.path}`

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, String(value))
    }
    url += `?${searchParams.toString()}`
  }

  return url
}

/**
 * Hybrid SPA Router - combines SSR-friendly initial load with client-side navigation
 */
export function Router<T extends string> ({
  routes,
  basePath = import.meta.env.BASE_URL,
  fallback,
  children,
}: RouterProps<T>) {
  // Parse initial route
  const [route, setRoute] = useState<MatchedRoute | null>(() => {
    if (typeof window === 'undefined') {
      // SSR: return first route as fallback
      const firstRouteName = Object.keys(routes)[0] as T
      return {
        name: firstRouteName,
        definition: routes[firstRouteName],
        params: {},
      }
    }
    return matchRoute(window.location, routes, basePath)
  })

  // Handle popstate (back/forward)
  useEffect(() => {
    const handlePopstate = () => {
      setRoute(matchRoute(window.location, routes, basePath))
    }
    window.addEventListener('popstate', handlePopstate)
    return () => window.removeEventListener('popstate', handlePopstate)
  }, [routes, basePath])

  // Navigate function
  const navigate = useCallback(
    (path: string) => {
      const url = new URL(path, window.location.origin)
      history.pushState(null, '', url.href)
      setRoute(matchRoute(url as unknown as Location, routes, basePath))
    },
    [routes, basePath]
  )

  // Build URL helper
  const buildUrl = useCallback(
    (routeName: string, params?: Record<string, string | number | boolean>) =>
      buildRouteUrl(routeName, routes, basePath, params),
    [routes, basePath]
  )

  // Context value
  const contextValue = useMemo(
    () => ({ route, navigate, buildUrl }),
    [route, navigate, buildUrl]
  )

  // Default fallback
  const loadingFallback = fallback ?? (
    <div className='w-full h-dvh bg-black flex items-center justify-center'>
      <div className='text-cyan-500/50 animate-pulse font-bold tracking-widest'>
        Loading...
      </div>
    </div>
  )

  if (!route) {
    return <>{loadingFallback}</>
  }

  return (
    <RouterContext value={contextValue}>
      <Suspense fallback={loadingFallback}>
        {children({ route, navigate })}
      </Suspense>
    </RouterContext>
  )
}
