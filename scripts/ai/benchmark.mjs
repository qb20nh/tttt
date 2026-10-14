import { resolve } from 'node:path'
import { loadEngine, positionSuite, searchPosition, argument, report } from './harness.mjs'

const current = loadEngine(resolve(argument('engine', '.')))
const baselinePath = argument('baseline', '')
const baseline = baselinePath ? loadEngine(resolve(baselinePath)) : null
const budget = Number(argument('budget', '50'))
const fixedDepth = Number(argument('depth', '5'))
const depths = argument('boards', '2,3,4').split(',').map(Number)
const samples = Number(argument('samples', '6'))
const results = []
const positions = positionSuite(current, depths, samples)

// Warm-up is excluded, and both engines receive the same position sequence.
for (const engine of [baseline, current].filter(Boolean)) searchPosition(engine, positions[0].state, 2, 1000)
for (const { name, state } of positions) {
  for (const [version, engine] of [['baseline', baseline], ['current', current]]) {
    if (!engine) continue
    const fixed = searchPosition(engine, state, fixedDepth, 30000)
    const timed = searchPosition(engine, state, 30, budget)
    results.push({
      position: name,
      version,
      fixed: { ...fixed, elapsed: Number(fixed.elapsed.toFixed(3)), nps: Math.round(fixed.nodes / (fixed.elapsed / 1000)) },
      timed: { ...timed, elapsed: Number(timed.elapsed.toFixed(3)), nps: Math.round(timed.nodes / (timed.elapsed / 1000)) },
    })
    console.error(`${name} ${version}: fixed ${fixed.elapsed.toFixed(1)}ms / ${fixed.nodes} nodes, ${budget}ms depth ${timed.depth} (${timed.elapsed.toFixed(1)}ms)`)
  }
}
report({ budget, fixedDepth, samples, results })
