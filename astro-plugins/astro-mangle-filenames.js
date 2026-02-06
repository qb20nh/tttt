/**
 * Astro integration to mangle JS/CSS filenames while preserving hash segment.
 * Example: HomeScreen.DYCgkiHg.js -> a.DYCgkiHg.js
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  applyIfSmaller,
  collectFilesByExts,
  getByteLength,
  recordSavings,
  readTextFile,
  shortName,
  bumpCount,
  sortByUsage,
} from './utils.js'

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** @returns {import('astro').AstroIntegration} */
export function mangleFilenames () {
  return {
    name: 'mangle-filenames',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname
        const astroDir = path.join(distPath, '_astro')
        if (!fs.existsSync(astroDir)) {
          console.log(
            '\x1b[33m[mangle-filenames] No dist/_astro directory found.\x1b[0m'
          )
          return
        }

        const entries = fs
          .readdirSync(astroDir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)

        let targets = entries
          .filter((name) => name.endsWith('.js') || name.endsWith('.css'))

        const scanFilesForCounts = collectFilesByExts(distPath, [
          '.js',
          '.html',
          '.css',
          '.json',
        ])

        const nameCounts = new Map()
        if (targets.length > 0 && scanFilesForCounts.length > 0) {
          const countPattern = new RegExp(
            [...targets]
              .sort((a, b) => getByteLength(b) - getByteLength(a) || a.localeCompare(b))
              .map((name) => escapeRegExp(name))
              .join('|'),
            'g'
          )
          for (const file of scanFilesForCounts) {
            const content = readTextFile(file)
            countPattern.lastIndex = 0
            let match
            while ((match = countPattern.exec(content))) {
              bumpCount(nameCounts, match[0])
            }
          }
        }

        targets = sortByUsage(targets, nameCounts)

        const usedNames = new Set(entries)
        const renames = new Map()
        let counter = 0

        for (const name of targets) {
          const originalBytes = getByteLength(name)
          const workerMatch = name.match(/^worker-([A-Za-z0-9_-]+)\.js$/)
          if (workerMatch) {
            const id = workerMatch[1]
            usedNames.delete(name)
            let nextName = null
            const baseName = `w-${id}.js`
            if (getByteLength(baseName) < originalBytes) {
              if (!usedNames.has(baseName)) {
                nextName = baseName
              } else {
                while (true) {
                  const suffix = shortName(counter++)
                  const candidate = `w${suffix}-${id}.js`
                  if (getByteLength(candidate) >= originalBytes) break
                  if (!usedNames.has(candidate)) {
                    nextName = candidate
                    break
                  }
                }
              }
            }
            if (nextName && applyIfSmaller(name, nextName) === nextName) {
              usedNames.add(nextName)
              renames.set(name, nextName)
            } else {
              usedNames.add(name)
            }
            continue
          }

          const parts = name.split('.')
          if (parts.length < 3) continue
          const ext = parts[parts.length - 1]
          const hash = parts[parts.length - 2]
          if (!/^[A-Za-z0-9_-]+$/.test(hash)) continue

          usedNames.delete(name)
          let nextName = null
          while (true) {
            const base = shortName(counter++)
            const candidate = `${base}.${hash}.${ext}`
            if (getByteLength(candidate) >= originalBytes) break
            if (!usedNames.has(candidate)) {
              nextName = candidate
              break
            }
          }

          if (nextName && applyIfSmaller(name, nextName) === nextName) {
            usedNames.add(nextName)
            renames.set(name, nextName)
          } else {
            usedNames.add(name)
          }
        }

        if (renames.size === 0) {
          console.log('\x1b[32m[mangle-filenames] No files renamed.\x1b[0m')
          return
        }

        for (const [oldName, newName] of renames) {
          const from = path.join(astroDir, oldName)
          const to = path.join(astroDir, newName)
          fs.renameSync(from, to)
        }

        const scanFiles = collectFilesByExts(distPath, [
          '.js',
          '.html',
          '.css',
          '.json',
        ])

        const replacements = [...renames.entries()].sort(
          (a, b) => b[0].length - a[0].length
        )
        const lookupMap = new Map(replacements)
        const pattern = new RegExp(
          replacements.map(([oldName]) => escapeRegExp(oldName)).join('|'),
          'g'
        )

        let updated = 0
        let totalSaved = 0
        for (const file of scanFiles) {
          const original = readTextFile(file)
          pattern.lastIndex = 0
          const next = original.replace(pattern, (match) => lookupMap.get(match) || match)
          if (next !== original) {
            fs.writeFileSync(file, next)
            updated++
            totalSaved += getByteLength(original) - getByteLength(next)
          }
        }

        console.log(
          `\x1b[32m[mangle-filenames] Renamed ${renames.size} file(s), updated ${updated} file(s), saved ${totalSaved} bytes.\x1b[0m`
        )
        recordSavings('mangle-filenames', totalSaved)
      },
    },
  }
}

export default mangleFilenames
