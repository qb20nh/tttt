import type { ComponentType, LazyExoticComponent } from 'react'

/**
 * Route definition for a single route
 */
export interface RouteDefinition {
  /** URL path pattern (without base URL) */
  path: string
  /** Lazy-loaded component - any component type */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: LazyExoticComponent<ComponentType<any>>
  /** Query parameter names to extract */
  params?: string[]
  /** Default values for params */
  defaults?: Record<string, string>
}

/**
 * Routes configuration object
 */
export type RoutesConfig<T extends string = string> = Record<T, RouteDefinition>

/**
 * Matched route with extracted params
 */
export interface MatchedRoute {
  /** Route name/key */
  name: string
  /** Route definition */
  definition: RouteDefinition
  /** Extracted params */
  params: Record<string, string>
}

/**
 * Router context value
 */
export interface RouterContextValue {
  /** Current matched route */
  route: MatchedRoute | null
  /** Navigate to a path */
  navigate: (path: string) => void
  /** Build URL for a route */
  buildUrl: (routeName: string, params?: Record<string, string | number | boolean>) => string
}
