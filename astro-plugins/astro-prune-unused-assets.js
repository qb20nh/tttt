/**
 * Astro integration to remove unused _astro assets from the build output.
 * Helps avoid duplicate chunks (e.g. multiple worker bundles).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  collectFilesByExts,
  recordSavings,
  readTextFile,
} from './utils.js'

/** @returns {import('astro').AstroIntegration} */
export function pruneUnusedAssets () {
  return {
    name: 'prune-unused-assets',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname
        const scanFiles = collectFilesByExts(distPath, [
          '.js',
          '.html',
          '.css',
          '.json',
        ])

        const astroDir = path.join(distPath, '_astro')
        if (!fs.existsSync(astroDir)) {
          console.log(
            '\x1b[33m[prune-unused-assets] No dist/_astro directory found.\x1b[0m'
          )
          return
        }

        const assets = fs
          .readdirSync(astroDir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)

        const fileContents = new Map()
        const getContent = (file) => {
          if (!fileContents.has(file)) {
            fileContents.set(file, readTextFile(file))
          }
          return fileContents.get(file)
        }

        const isReferenced = (name) => {
          for (const file of scanFiles) {
            const content = getContent(file)
            if (content.includes(name)) return true
          }
          return false
        }

        let removed = 0
        let bytesRemoved = 0
        for (const name of assets) {
          if (!isReferenced(name)) {
            const filePath = path.join(astroDir, name)
            const stat = fs.statSync(filePath)
            fs.unlinkSync(filePath)
            removed++
            bytesRemoved += stat.size
            console.log(
              `\x1b[33m[prune-unused-assets] removed ${path.relative(distPath, filePath)}\x1b[0m`
            )
          }
        }

        console.log(
          `\x1b[32m[prune-unused-assets] Removed ${removed} unused _astro file(s), saved ${bytesRemoved} bytes.\x1b[0m`
        )
        recordSavings('prune-unused-assets', bytesRemoved)
      },
    },
  }
}

export default pruneUnusedAssets
