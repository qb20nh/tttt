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
