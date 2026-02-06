import fs from 'node:fs'
import path from 'node:path'

export function findFiles (dir, ext) {
  const files = []
  function walk (d) {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(f)
      } else if (e.name.endsWith(ext)) {
        files.push(f)
      }
    }
  }
  walk(dir)
  return files
}

export function collectFilesByExts (dir, exts) {
  const out = new Set()
  for (const ext of exts) {
    for (const file of findFiles(dir, ext)) {
      out.add(file)
    }
  }
  return [...out]
}

export function readTextFile (file) {
  return fs.readFileSync(file, 'utf-8')
}

export function buildContentBlob (files) {
  return files.map((file) => readTextFile(file)).join('\n')
}

export function logSavedBytes (prefix, distPath, file, saved) {
  console.log(
    `\x1b[32m[${prefix}] ${path.relative(distPath, file)}: saved ${saved} bytes\x1b[0m`
  )
}

export function getByteLength (value) {
  return Buffer.byteLength(value, 'utf-8')
}

export function bumpCount (counts, key, amount = 1) {
  counts.set(key, (counts.get(key) || 0) + amount)
}

export function sortByUsage (items, counts, getLength = (value) => getByteLength(value), getKey = (value) => value) {
  return [...items].sort((a, b) => {
    const countDiff = (counts.get(b) || 0) - (counts.get(a) || 0)
    if (countDiff) return countDiff
    const lenDiff = getLength(b) - getLength(a)
    if (lenDiff) return lenDiff
    const aKey = getKey(a)
    const bKey = getKey(b)
    return String(aKey).localeCompare(String(bKey))
  })
}

export function applyIfSmaller (original, next) {
  return getByteLength(next) < getByteLength(original) ? next : original
}

export function writeFileIfSmaller (file, original, next) {
  const chosen = applyIfSmaller(original, next)
  if (chosen !== original) {
    fs.writeFileSync(file, chosen)
    return getByteLength(original) - getByteLength(chosen)
  }
  return 0
}

const ALPHABET_62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function shortName (index, alphabet = ALPHABET_62) {
  const base = alphabet.length
  let out = ''
  let i = index
  do {
    out = alphabet[i % base] + out
    i = Math.floor(i / base) - 1
  } while (i >= 0)
  return out
}

const savingsState = {
  total: 0,
  byPlugin: new Map(),
}

export function resetSavings () {
  savingsState.total = 0
  savingsState.byPlugin.clear()
}

export function recordSavings (plugin, bytes) {
  if (!bytes || bytes <= 0) return
  const current = savingsState.byPlugin.get(plugin) || 0
  savingsState.byPlugin.set(plugin, current + bytes)
  savingsState.total += bytes
}

export function getSavingsReport () {
  const byPlugin = [...savingsState.byPlugin.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  return { total: savingsState.total, byPlugin }
}

export function scanStringLiteral (code, start) {
  const quote = code[start]
  let i = start + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i++
  }
  return code.length
}

export function scanTemplateLiteral (code, start) {
  let i = start + 1
  let hasExpr = false

  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') return { end: i + 1, hasExpr }
    if (ch === '$' && code[i + 1] === '{' && !isEscaped(code, i)) {
      hasExpr = true
      i = scanTemplateExpression(code, i + 2)
      continue
    }
    i++
  }
  return null
}

export function scanTemplateExpression (code, start) {
  let i = start
  let depth = 1

  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) return code.length
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) return code.length
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      i = scanStringLiteral(code, i)
      continue
    }

    if (ch === '`') {
      const inner = scanTemplateLiteral(code, i)
      if (!inner) return code.length
      i = inner.end
      continue
    }

    if (ch === '{') {
      depth++
      i++
      continue
    }

    if (ch === '}') {
      depth--
      i++
      if (depth === 0) return i
      continue
    }

    i++
  }
  return code.length
}

export function isEscaped (code, index) {
  let backslashes = 0
  let i = index - 1
  while (i >= 0 && code[i] === '\\') {
    backslashes++
    i--
  }
  return backslashes % 2 === 1
}
