/**
 * Astro integration to optimize GLSL shader strings embedded in JS bundles.
 * Applies only size-reducing transforms.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  findFiles,
  scanStringLiteral,
  scanTemplateLiteral,
} from './utils.js'

/** @returns {import('astro').AstroIntegration} */
export function optimizeShader () {
  return {
    name: 'optimize-shader',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname
        const jsFiles = findFiles(distPath, '.js')
        let totalSaved = 0

        console.log('[optimize-shader] Shader Optimization Phase...')

        for (const file of jsFiles) {
          const original = fs.readFileSync(file, 'utf-8')
          const optimized = optimizeShadersInJs(original)
          if (optimized.length < original.length) {
            fs.writeFileSync(file, optimized)
            const saved = original.length - optimized.length
            totalSaved += saved
            console.log(`\x1b[32m[optimize-shader] ${path.relative(distPath, file)}: saved ${saved} bytes\x1b[0m`)
          }
        }

        console.log(`\x1b[32m[optimize-shader] Total saved: ${totalSaved} bytes\x1b[0m`)
      }
    }
  }
}

function optimizeShadersInJs (code) {
  let out = ''
  let i = 0

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
      out += code.slice(i, end + 2)
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
      const original = code.slice(i, tpl.end)
      if (tpl.hasExpr) {
        out += original
      } else {
        const raw = code.slice(i + 1, tpl.end - 1)
        const optimized = optimizeShaderSource(raw)
        if (optimized && optimized.length < raw.length) {
          out += '`' + optimized + '`'
        } else {
          out += original
        }
      }
      i = tpl.end
      continue
    }

    out += ch
    i++
  }

  return out
}

function optimizeShaderSource (source) {
  if (!looksLikeShader(source)) return null
  let res = source
  res = applyIfSmaller(res, stripShaderComments(res))
  if (shouldMangleShaderIdentifiers(res)) {
    res = applyIfSmaller(res, mangleShaderIdentifiers(res))
  }
  res = applyIfSmaller(res, minifyShaderNumbers(res))
  res = applyIfSmaller(res, minifyShaderSpacing(res))
  return res
}

function looksLikeShader (source) {
  const hasMain = /void\s+main\s*\(/.test(source)
  if (/\bgl_(Position|FragColor|FragCoord)\b/.test(source)) return true
  if (/\bprecision\s+(lowp|mediump|highp)\b/.test(source)) return true
  if (/\b(uniform|varying|attribute|in|out)\b/.test(source)) return true
  if (/^\s*#(version|define|extension|pragma|include|if|ifdef|ifndef|elif|endif|undef|line)\b/m.test(source)) return true
  return hasMain
}

function shouldMangleShaderIdentifiers (source) {
  if (!/void\s+main\s*\(/.test(source)) return false
  if (/^\s*#/m.test(source)) return false
  return true
}

function stripShaderComments (source) {
  let res = source
  res = res.replace(/\/\*[\s\S]*?\*\//g, '')
  res = res.replace(/\/\/[^\n\r]*/g, '')
  return res
}

function minifyShaderNumbers (source) {
  const floatRe = /(?<![A-Za-z0-9_])([+-]?)(?:(\d+)\.(\d*)|\.(\d+))([eE][+-]?\d+)?/g
  return source.replace(floatRe, (match, sign, intPart, fracPart, fracOnly, exp) => {
    let intDigits = intPart || ''
    const fracDigits = fracPart != null ? fracPart : fracOnly || ''

    if (intDigits) {
      intDigits = intDigits.replace(/^0+(?=\d)/, '')
    }

    const trimmedFrac = fracDigits.replace(/0+$/, '')

    let mantissa = ''
    if (intDigits) {
      if (trimmedFrac.length === 0) {
        if (intDigits === '0') {
          mantissa = '.0'
        } else {
          mantissa = intDigits + '.'
        }
      } else {
        if (intDigits === '0') {
          mantissa = '.' + trimmedFrac
        } else {
          mantissa = intDigits + '.' + trimmedFrac
        }
      }
    } else {
      if (trimmedFrac.length === 0) {
        mantissa = '.0'
      } else {
        mantissa = '.' + trimmedFrac
      }
    }

    const next = sign + mantissa + (exp || '')
    return next.length < match.length ? next : match
  })
}

function minifyShaderSpacing (source) {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const hasLeadingNewline = normalized.startsWith('\n')
  const hasTrailingNewline = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  const out = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      out.push(minifyDirectiveLine(trimmed))
      continue
    }
    out.push(minifyShaderLine(trimmed))
  }

  let result = out.join('\n')
  if (hasLeadingNewline) result = '\n' + result
  if (hasTrailingNewline) result = result + '\n'
  return result
}

function minifyDirectiveLine (line) {
  const match = line.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/)
  if (!match) return '#' + line.slice(1).trim()

  const directive = match[1]
  const rest = match[2] || ''

  if (!rest) return `#${directive}`
  if (directive === 'include') {
    return `#include${rest.trim()}`
  }

  const minRest = minifyShaderLine(rest)
  return minRest ? `#${directive} ${minRest}` : `#${directive}`
}

function minifyShaderLine (line) {
  const tokens = tokenizeShader(line)
  let out = ''
  let prev = null

  for (const token of tokens) {
    if (token.type === 'ws') continue
    if (prev && needsShaderSpace(prev, token)) out += ' '
    out += token.value
    prev = token
  }

  return out
}

function needsShaderSpace (prev, next) {
  if (prev.type === 'id' && next.type === 'id') return true
  if (prev.type === 'id' && next.type === 'number') return true
  if (prev.type === 'number' && next.type === 'id') return true
  if (prev.type === 'number' && next.type === 'number') return true
  return false
}

function applyIfSmaller (original, next) {
  return next.length < original.length ? next : original
}

function mangleShaderIdentifiers (source) {
  const tokens = tokenizeShader(source)
  const identifiers = new Set()
  for (const token of tokens) {
    if (token.type === 'id') identifiers.add(token.value)
  }

  const macroNames = new Set()
  const macroMatches = source.matchAll(/^[ \t]*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)/gm)
  for (const match of macroMatches) macroNames.add(match[1])

  const structNames = new Set()
  const structMatches = source.matchAll(/\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)
  for (const match of structMatches) structNames.add(match[1])

  const builtinTypes = new Set([
    'void', 'bool', 'int', 'uint', 'float', 'double',
    'vec2', 'vec3', 'vec4',
    'ivec2', 'ivec3', 'ivec4',
    'uvec2', 'uvec3', 'uvec4',
    'bvec2', 'bvec3', 'bvec4',
    'dvec2', 'dvec3', 'dvec4',
    'mat2', 'mat3', 'mat4',
    'mat2x2', 'mat2x3', 'mat2x4',
    'mat3x2', 'mat3x3', 'mat3x4',
    'mat4x2', 'mat4x3', 'mat4x4',
    'sampler2D', 'sampler3D', 'samplerCube',
    'sampler2DArray', 'samplerCubeArray',
    'sampler2DShadow', 'samplerCubeShadow',
    'isampler2D', 'isampler3D', 'isamplerCube',
    'isampler2DArray', 'usampler2D', 'usampler3D',
    'usamplerCube', 'usampler2DArray'
  ])

  const keywords = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'discard',
    'struct', 'layout', 'in', 'out', 'inout', 'uniform', 'attribute', 'varying',
    'const', 'precision', 'lowp', 'mediump', 'highp',
    'flat', 'smooth', 'noperspective', 'centroid', 'sample', 'invariant',
    'true', 'false'
  ])

  const storageQualifiers = new Set(['uniform', 'in', 'out', 'attribute', 'varying', 'buffer', 'shared'])
  const precisionQualifiers = new Set(['lowp', 'mediump', 'highp', 'precision'])

  const typeSet = new Set([...builtinTypes, ...structNames])
  const reserved = new Set([...keywords, ...builtinTypes, ...macroNames, 'main'])
  for (const id of identifiers) {
    if (id.startsWith('gl_')) reserved.add(id)
  }

  const candidates = new Set()
  let sawStorage = false
  let pendingBlockStorage = false
  let blockStorageDepth = null
  let braceDepth = 0
  let skipPrecision = false

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]

    if (tok.type === 'op') {
      if (tok.value === '{') {
        braceDepth++
        if (pendingBlockStorage) {
          blockStorageDepth = braceDepth
          pendingBlockStorage = false
        }
      } else if (tok.value === '}') {
        if (blockStorageDepth != null && braceDepth === blockStorageDepth) {
          blockStorageDepth = null
        }
        braceDepth = Math.max(0, braceDepth - 1)
      } else if (tok.value === ';') {
        sawStorage = false
        pendingBlockStorage = false
        skipPrecision = false
      }
    }

    if (tok.type !== 'id') continue
    const val = tok.value

    if (val === 'precision') {
      skipPrecision = true
      continue
    }

    if (skipPrecision) continue

    if (storageQualifiers.has(val)) {
      sawStorage = true
      pendingBlockStorage = true
      continue
    }

    if (precisionQualifiers.has(val)) continue

    if (!typeSet.has(val)) continue

    const inStorageBlock = blockStorageDepth != null && braceDepth >= blockStorageDepth
    const storageContext = sawStorage || inStorageBlock

    let j = i + 1
    j = skipWs(tokens, j)

    if (tokens[j]?.type === 'id') {
      const name = tokens[j].value
      const next = skipWs(tokens, j + 1)
      if (tokens[next]?.value === '(') {
        considerCandidate(name, storageContext, candidates, reserved)
        continue
      }
    }

    while (j < tokens.length) {
      j = skipWs(tokens, j)
      if (tokens[j]?.type !== 'id') break
      const name = tokens[j].value
      considerCandidate(name, storageContext, candidates, reserved)
      j++

      j = skipWs(tokens, j)
      if (tokens[j]?.value === '[') {
        j = skipBracket(tokens, j, '[', ']')
        j = skipWs(tokens, j)
      }

      if (tokens[j]?.value === '=') {
        j = skipInitializer(tokens, j + 1)
      }

      if (tokens[j]?.value === ',') {
        j++
        continue
      }
      break
    }
  }

  if (candidates.size === 0) return source

  const renameMap = new Map()
  const used = new Set(identifiers)
  const sortedCandidates = [...candidates].sort((a, b) => b.length - a.length || a.localeCompare(b))
  let counter = 0

  for (const name of sortedCandidates) {
    let next = null
    while (true) {
      const candidate = shortAlphabetName(counter++)
      if (reserved.has(candidate) || used.has(candidate)) continue
      next = candidate
      break
    }
    if (!next || next.length >= name.length) continue
    renameMap.set(name, next)
    used.add(next)
  }

  if (renameMap.size === 0) return source

  let out = ''
  for (const token of tokens) {
    if (token.type === 'id' && renameMap.has(token.value)) {
      out += renameMap.get(token.value)
    } else {
      out += token.value
    }
  }

  return out.length < source.length ? out : source
}

function considerCandidate (name, isStorage, candidates, reserved) {
  if (!name || reserved.has(name) || name.startsWith('gl_')) return
  if (isStorage) {
    reserved.add(name)
    return
  }
  candidates.add(name)
}

function skipWs (tokens, index) {
  let i = index
  while (i < tokens.length && tokens[i].type === 'ws') i++
  return i
}

function skipBracket (tokens, index, open, close) {
  let depth = 0
  let i = index
  while (i < tokens.length) {
    const tok = tokens[i]
    if (tok.value === open) depth++
    else if (tok.value === close) depth--
    i++
    if (depth === 0) break
  }
  return i
}

function skipInitializer (tokens, index) {
  let i = index
  let paren = 0
  let bracket = 0
  let brace = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (tok.value === '(') paren++
    else if (tok.value === ')') { if (paren > 0) paren-- } else if (tok.value === '[') bracket++
    else if (tok.value === ']') { if (bracket > 0) bracket-- } else if (tok.value === '{') brace++
    else if (tok.value === '}') { if (brace > 0) brace-- } else if (paren === 0 && bracket === 0 && brace === 0) {
      if (tok.value === ',' || tok.value === ';') break
    }
    i++
  }
  return i
}

function tokenizeShader (source) {
  const tokens = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      let j = i + 1
      while (j < source.length && /\s/.test(source[j])) j++
      tokens.push({ type: 'ws', value: source.slice(i, j) })
      i = j
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++
      tokens.push({ type: 'id', value: source.slice(i, j) })
      i = j
      continue
    }

    if (/\d/.test(ch) || (ch === '.' && /\d/.test(source[i + 1] || ''))) {
      let j = i + 1
      while (j < source.length && /[0-9.eE+-]/.test(source[j])) j++
      tokens.push({ type: 'number', value: source.slice(i, j) })
      i = j
      continue
    }

    tokens.push({ type: 'op', value: ch })
    i++
  }
  return tokens
}

function shortAlphabetName (index) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let name = ''
  let n = index
  do {
    name = chars[n % 52] + name
    n = Math.floor(n / 52) - 1
  } while (n >= 0)
  return name
}

export default optimizeShader
