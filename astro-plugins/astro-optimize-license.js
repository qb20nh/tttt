/**
 * Astro integration to deduplicate license/copyright comments per output file.
 * Applies only size-reducing transforms.
 */
import {
  collectFilesByExts,
  readTextFile,
  scanStringLiteral,
  scanTemplateLiteral,
  logSavedBytes,
  recordSavings,
  writeFileIfSmaller,
} from './utils.js'

/** @returns {import('astro').AstroIntegration} */
export function optimizeLicense () {
  return {
    name: 'optimize-license',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname
        const files = collectFilesByExts(distPath, ['.js', '.css'])
        let totalSaved = 0

        console.log('[optimize-license] Removing duplicate license notices...')

        for (const file of files) {
          const original = readTextFile(file)
          const optimized = dedupeLicenseComments(original)
          const saved = writeFileIfSmaller(file, original, optimized)
          if (saved > 0) {
            totalSaved += saved
            logSavedBytes('optimize-license', distPath, file, saved)
          }
        }

        console.log(`\x1b[32m[optimize-license] Total saved: ${totalSaved} bytes\x1b[0m`)
        recordSavings('optimize-license', totalSaved)
      },
    },
  }
}

function dedupeLicenseComments (code) {
  let out = ''
  let i = 0
  const seen = new Set()

  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) {
        out += code.slice(i)
        break
      }
      out += code.slice(i, end + 1)
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) {
        out += code.slice(i)
        break
      }
      const comment = code.slice(i, end + 2)
      if (isLicenseComment(comment)) {
        const key = normalizeLicenseComment(comment)
        if (seen.has(key)) {
          i = end + 2
          continue
        }
        seen.add(key)
      }
      out += comment
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const end = scanStringLiteral(code, i)
      out += code.slice(i, end)
      i = end
      continue
    }

    if (ch === '`') {
      const tpl = scanTemplateLiteral(code, i)
      if (!tpl) {
        out += code.slice(i)
        break
      }
      out += code.slice(i, tpl.end)
      i = tpl.end
      continue
    }

    out += ch
    i++
  }

  return out
}

function isLicenseComment (comment) {
  if (comment.startsWith('/*!')) return true
  const body = comment.slice(2, -2)
  return /@license|@preserve|copyright|license/i.test(body)
}

function normalizeLicenseComment (comment) {
  let body = comment.slice(2, -2)
  body = body.replace(/^!/, '')
  body = body.replace(/\r\n/g, '\n')
  const lines = body.split('\n').map((line) =>
    line.replace(/^\s*\*? ?/, '').trim()
  )
  body = lines.join('\n')
  body = body.replace(/\s+/g, ' ').trim()
  return body.toLowerCase()
}

export default optimizeLicense
