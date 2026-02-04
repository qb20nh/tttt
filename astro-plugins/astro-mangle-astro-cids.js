/**
 * Astro integration to mangle astro component scope IDs (data-astro-cid-*).
 */
import fs from 'node:fs'
import {
  collectFilesByExts,
  getByteLength,
  recordSavings,
  readTextFile,
  shortName,
} from './utils.js'

const CID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** @returns {import('astro').AstroIntegration} */
export function mangleAstroCids () {
  return {
    name: 'mangle-astro-cids',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname
        const scanFiles = collectFilesByExts(distPath, [
          '.html',
          '.css',
          '.js',
        ])

        const ids = new Set()
        const cidPattern = /astro-cid-([A-Za-z0-9]+)/g
        for (const file of scanFiles) {
          const content = readTextFile(file)
          cidPattern.lastIndex = 0
          let match
          while ((match = cidPattern.exec(content))) {
            ids.add(match[1])
          }
        }

        if (ids.size === 0) {
          console.log('\x1b[32m[mangle-astro-cids] No cids found.\x1b[0m')
          return
        }

        const reserved = new Set(ids)
        const used = new Set()
        const mapping = new Map()
        let counter = 0

        for (const id of [...ids].sort()) {
          const idBytes = getByteLength(id)
          let next = null
          while (true) {
            const candidate = shortName(counter++, CID_ALPHABET)
            if (getByteLength(candidate) >= idBytes) break
            if (reserved.has(candidate) || used.has(candidate)) continue
            next = candidate
            break
          }
          if (!next) continue
          mapping.set(id, next)
          used.add(next)
        }

        if (mapping.size === 0) {
          console.log('\x1b[32m[mangle-astro-cids] No shorter cid mappings found.\x1b[0m')
          return
        }

        let updated = 0
        let totalSaved = 0
        for (const file of scanFiles) {
          const original = readTextFile(file)
          cidPattern.lastIndex = 0
          const next = original.replace(cidPattern, (full, id) => {
            const mapped = mapping.get(id)
            if (!mapped) return full
            return `astro-cid-${mapped}`
          })
          if (next !== original) {
            updated++
            totalSaved += getByteLength(original) - getByteLength(next)
            fs.writeFileSync(file, next)
          }
        }

        console.log(
          `\x1b[32m[mangle-astro-cids] Mapped ${mapping.size} cid(s), updated ${updated} file(s), saved ${totalSaved} bytes.\x1b[0m`
        )
        recordSavings('mangle-astro-cids', totalSaved)
      },
    },
  }
}

export default mangleAstroCids
