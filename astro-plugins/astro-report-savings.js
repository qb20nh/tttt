/**
 * Astro integration to report combined savings for custom plugins.
 */
import { getSavingsReport, resetSavings } from './utils.js'

/** @returns {import('astro').AstroIntegration} */
export function reportSavings (plugins = null) {
  return {
    name: 'report-savings',
    hooks: {
      'astro:build:start': () => {
        resetSavings()
      },
      'astro:build:done': () => {
        const { total, byPlugin } = getSavingsReport()
        if (byPlugin.length === 0) {
          console.log('\x1b[33m[report-savings] No plugin savings recorded.\x1b[0m')
          return
        }

        let entries = byPlugin
        if (Array.isArray(plugins) && plugins.length > 0) {
          const lookup = new Map(byPlugin.map((entry) => [entry.name, entry.bytes]))
          const names = plugins
            .map((plugin) => (plugin && typeof plugin === 'object' ? plugin.name : null))
            .filter(Boolean)
          entries = names.map((name) => ({
            name,
            bytes: lookup.get(name) || 0,
          }))
        }

        const scopedTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0)

        console.log('\x1b[36m[report-savings] Combined plugin savings:\x1b[0m')
        for (const entry of entries) {
          console.log(
            `\x1b[36m[report-savings] - ${entry.name}: ${entry.bytes} bytes\x1b[0m`
          )
        }
        console.log(
          `\x1b[36m[report-savings] Total saved: ${scopedTotal} bytes\x1b[0m`
        )
        if (Array.isArray(plugins) && plugins.length > 0 && scopedTotal !== total) {
          console.log(
            `\x1b[36m[report-savings] (All plugins total: ${total} bytes)\x1b[0m`
          )
        }
      },
    },
  }
}

function collectIntegrations (input, out = []) {
  if (!input) return out
  if (Array.isArray(input)) {
    for (const item of input) collectIntegrations(item, out)
    return out
  }
  if (typeof input === 'object') {
    if (input && typeof input.hooks === 'object') {
      out.push(input)
      return out
    }
    if (Array.isArray(input.plugins)) {
      for (const item of input.plugins) collectIntegrations(item, out)
      return out
    }
  }
  return out
}

function getPluginNames (integrations) {
  const names = new Set()
  for (const integration of integrations) {
    if (integration && typeof integration.name === 'string') {
      names.add(integration.name)
    }
  }
  return [...names]
}

function collectHookNames (integrations) {
  const hookNames = new Set()
  for (const integration of integrations) {
    const hooks = integration && integration.hooks
    if (!hooks || typeof hooks !== 'object') continue
    for (const [hookName, handler] of Object.entries(hooks)) {
      if (typeof handler === 'function') hookNames.add(hookName)
    }
  }
  return hookNames
}

async function runHook (integrations, hookName, args) {
  for (const integration of integrations) {
    const handler = integration && integration.hooks && integration.hooks[hookName]
    if (typeof handler === 'function') {
      await handler(...args)
    }
  }
}

function reportScopedSavings (integrations) {
  const { total, byPlugin } = getSavingsReport()
  if (byPlugin.length === 0) {
    console.log('\x1b[33m[report-savings] No plugin savings recorded.\x1b[0m')
    return
  }

  const names = getPluginNames(integrations)
  const lookup = new Map(byPlugin.map((entry) => [entry.name, entry.bytes]))
  const entries = (names.length > 0 ? names : byPlugin.map((entry) => entry.name)).map(
    (name) => ({
      name,
      bytes: lookup.get(name) || 0,
    })
  )

  entries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  const scopedTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0)

  console.log('\x1b[36m[report-savings] Combined plugin savings:\x1b[0m')
  for (const entry of entries) {
    console.log(`\x1b[36m[report-savings] - ${entry.name}: ${entry.bytes} bytes\x1b[0m`)
  }
  console.log(`\x1b[36m[report-savings] Total saved: ${scopedTotal} bytes\x1b[0m`)
  if (scopedTotal !== total) {
    console.log(`\x1b[36m[report-savings] (All plugins total: ${total} bytes)\x1b[0m`)
  }
}

export function withReportSavings (plugins = []) {
  const integrations = collectIntegrations(plugins)
  const hookNames = collectHookNames(integrations)
  hookNames.add('astro:build:start')
  hookNames.add('astro:build:done')

  const hooks = {}

  for (const hookName of hookNames) {
    if (hookName === 'astro:build:start') {
      hooks[hookName] = async (...args) => {
        resetSavings()
        await runHook(integrations, hookName, args)
      }
      continue
    }
    if (hookName === 'astro:build:done') {
      hooks[hookName] = async (...args) => {
        await runHook(integrations, hookName, args)
        reportScopedSavings(integrations)
      }
      continue
    }
    hooks[hookName] = async (...args) => {
      await runHook(integrations, hookName, args)
    }
  }

  return {
    name: 'with-report-savings',
    hooks,
  }
}

export default reportSavings
