/**
 * Astro integration for stable size optimization.
 * Focuses on shortening tokens (variables/classes) and pruning boilerplate.
 * Avoids dangerous global inlining to prevent CSS corruption.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  collectFilesByExts,
  applyIfSmaller,
  getByteLength,
  readTextFile,
  recordSavings,
  shortName,
  bumpCount,
  sortByUsage,
} from './utils.js'

const ALPHABET_ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function makeCountingSet (set, counts) {
  return {
    add: (value) => {
      set.add(value)
      bumpCount(counts, value)
    },
  }
}

/** @returns {import('astro').AstroIntegration} */
export function mangleCSS () {
  return {
    name: 'mangle-css',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distPath = dir.pathname

        const htmlFiles = collectFilesByExts(distPath, ['.html'])
        const cssFiles = collectFilesByExts(distPath, ['.css'])
        const jsFiles = collectFilesByExts(distPath, ['.js'])
        const allFiles = [...htmlFiles, ...cssFiles, ...jsFiles]
        const fileContents = new Map()
        for (const file of allFiles) {
          fileContents.set(file, readTextFile(file))
        }

        const varMap = new Map()
        const classMap = new Map()
        const cssClassMap = new Map()
        const idMap = new Map()
        const cssIdMap = new Map()
        const varCounts = new Map()
        const classCounts = new Map()
        const idCounts = new Map()

        let varCounter = 0
        let classCounter = 0
        let idCounter = 0
        let varMangleCount = 0
        let classMangleCount = 0
        let idMangleCount = 0

        const getShortVar = () => {
          const name = shortName(varCounter++, ALPHABET_ALPHA)
          return `--${name}`
        }

        console.log('[mangle-css] Minifying CSS classes and variables...')

        // 1. Collect all CSS variable names to shorten (include JS usage)
        const varNames = new Set()
        for (const file of [...cssFiles, ...htmlFiles, ...jsFiles]) {
          const content = fileContents.get(file)
          const varMatches = content.match(/--[a-zA-Z0-9_-]+/g)
          if (varMatches) {
            for (const v of varMatches) {
              varNames.add(v)
              bumpCount(varCounts, v)
            }
          }
        }

        const reservedVars = new Set(varNames)
        const usedShortVars = new Set()
        const sortedVarNames = sortByUsage(varNames, varCounts)
        for (const v of sortedVarNames) {
          if (getByteLength(v) <= 5) continue
          let short = getShortVar()
          while (reservedVars.has(short) || usedShortVars.has(short)) {
            short = getShortVar()
          }
          if (getByteLength(short) >= getByteLength(v)) continue
          varMap.set(v, short)
          usedShortVars.add(short)
          varMangleCount++
        }

        const sortedVarTokens = [...varMap.entries()].sort((a, b) => b[0].length - a[0].length)

        // 2. Collect all CSS class names from stylesheets
        const classPairs = []
        const classNames = new Set()
        for (const file of cssFiles) {
          const content = fileContents.get(file)
          const classes = collectCssClasses(content)
          for (const { escaped, unescaped } of classes) {
            classPairs.push({ escaped, unescaped })
            classNames.add(unescaped)
          }
        }

        // 3. Collect all CSS id names from stylesheets
        const idPairs = []
        const idNames = new Set()
        for (const file of cssFiles) {
          const content = fileContents.get(file)
          const ids = collectCssIds(content)
          for (const { escaped, unescaped } of ids) {
            idPairs.push({ escaped, unescaped })
            idNames.add(unescaped)
          }
        }

        // 3b. Count class/id usage in stylesheets
        for (const file of cssFiles) {
          const content = fileContents.get(file)
          countCssClassOccurrences(content, classNames, classCounts)
          countCssIdOccurrences(content, idNames, idCounts)
        }

        // 4. Collect class/id usage from HTML and JS to avoid mangling dynamic-only tokens
        const usedClassNames = new Set()
        const usedIdNames = new Set()
        const htmlIdNames = new Set()
        const classUseSink = makeCountingSet(usedClassNames, classCounts)
        const idUseSink = makeCountingSet(usedIdNames, idCounts)
        for (const file of htmlFiles) {
          const content = fileContents.get(file)
          const classMatches = content.matchAll(CLASS_ATTR_RE)
          for (const match of classMatches) {
            const value = match[1] ?? match[2] ?? match[3] ?? ''
            collectClassTokensFromString(value, classNames, classUseSink)
          }

          const idMatches = content.matchAll(ID_ATTR_RE)
          for (const match of idMatches) {
            const value = match[2] ?? match[3] ?? match[4] ?? ''
            collectIdTokensFromString(value, idNames, idUseSink, htmlIdNames)
          }

          const refAttrMatches = content.matchAll(ID_REF_ATTR_RE)
          for (const match of refAttrMatches) {
            const value = match[3] ?? match[4] ?? match[5] ?? ''
            collectIdTokensFromString(value, idNames, idUseSink)
          }

          const hrefMatches = content.matchAll(/\b(?:xlink:href|href)=(["'])#([^"']+)\1/gi)
          for (const match of hrefMatches) {
            const token = match[2]
            if (idNames.has(token)) idUseSink.add(token)
          }

          const urlMatches = content.matchAll(/url\(\s*(['"])?#([^'")\s]+)\1\s*\)/gi)
          for (const match of urlMatches) {
            const token = match[2]
            if (idNames.has(token)) idUseSink.add(token)
          }

          content.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, body) => {
            collectUsedClassesFromJs(body, classNames, classUseSink)
            collectUsedIdsFromJs(body, idNames, idUseSink)
            return m
          })
        }

        for (const file of jsFiles) {
          const content = fileContents.get(file)
          collectUsedClassesFromJs(content, classNames, classUseSink)
          collectUsedIdsFromJs(content, idNames, idUseSink)
        }

        const reservedClasses = new Set(usedClassNames)
        const usedShortClasses = new Set()
        const sortedClassNames = sortByUsage(usedClassNames, classCounts)
        for (const name of sortedClassNames) {
          let candidate = null
          let candidateCounter = classCounter
          while (true) {
            const short = shortName(candidateCounter, ALPHABET_ALPHA)
            if (reservedClasses.has(short) || usedShortClasses.has(short)) {
              candidateCounter++
              continue
            }
            candidate = short
            break
          }

          if (!candidate || getByteLength(candidate) >= getByteLength(name)) {
            classCounter = candidateCounter
            continue
          }

          classMap.set(name, candidate)
          usedShortClasses.add(candidate)
          classCounter = candidateCounter + 1
          classMangleCount++
        }

        const reservedIds = new Set([...idNames, ...htmlIdNames])
        const usedShortIds = new Set()
        const sortedIdNames = sortByUsage(usedIdNames, idCounts)
        for (const name of sortedIdNames) {
          let candidate = null
          let candidateCounter = idCounter
          while (true) {
            const short = shortName(candidateCounter, ALPHABET_ALPHA)
            if (reservedIds.has(short) || usedShortIds.has(short)) {
              candidateCounter++
              continue
            }
            candidate = short
            break
          }

          if (!candidate || getByteLength(candidate) >= getByteLength(name)) {
            idCounter = candidateCounter
            continue
          }

          idMap.set(name, candidate)
          usedShortIds.add(candidate)
          idCounter = candidateCounter + 1
          idMangleCount++
        }

        console.log(
          `[mangle-css] Mapped ${varMangleCount} variables, ${classMangleCount} classes, and ${idMangleCount} ids.`
        )

        for (const { escaped, unescaped } of classPairs) {
          const short = classMap.get(unescaped)
          if (!short) continue
          cssClassMap.set(escaped, cssEscape(short))
        }

        for (const { escaped, unescaped } of idPairs) {
          const short = idMap.get(unescaped)
          if (!short) continue
          cssIdMap.set(escaped, cssEscape(short))
        }

        let totalSaved = 0

        // 3. Transformation
        for (const file of allFiles) {
          const originalContent = fileContents.get(file)
          const originalBytes = getByteLength(originalContent)
          let content = originalContent

          if (file.endsWith('.css')) {
            content = processCSS(content, sortedVarTokens, cssClassMap, cssIdMap)
          } else if (file.endsWith('.html')) {
            // Protect JS and Style blocks
            const scriptBlocks = []
            content = content.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
              const processed = replaceInJs(body, classMap, sortedVarTokens, idMap)
              scriptBlocks.push(`<script${attrs}>${processed}</script>`)
              return `__JS${scriptBlocks.length - 1}__`
            })

            const styleBlocks = []
            content = content.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, body) => {
              const processed = processCSS(body, sortedVarTokens, cssClassMap, cssIdMap)
              styleBlocks.push(`<style${attrs}>${processed}</style>`)
              return `__CSS${styleBlocks.length - 1}__`
            })

            // Mangle classes in class attributes (quoted or unquoted)
            content = content.replace(CLASS_ATTR_RE, (match, dq, sq, uq) => {
              const classes = dq ?? sq ?? uq ?? ''
              const replaced = replaceClassTokensInString(classes, classMap)
              if (dq != null) return `class="${replaced}"`
              if (sq != null) return `class='${replaced}'`
              return `class=${replaced}`
            })

            content = replaceHtmlIdReferences(content, idMap)

            // Replace CSS variables globally in HTML
            for (const [o, s] of sortedVarTokens) {
              content = content.split(o).join(s)
            }

            // Restore blocks
            content = content.replace(/__CSS(\d+)__/g, (match, idx) => styleBlocks[parseInt(idx)])
            content = content.replace(/__JS(\d+)__/g, (match, idx) => scriptBlocks[parseInt(idx)])

            // Final HTML minification
            content = applyIfSmaller(content, minifyHtml(content))
          } else if (file.endsWith('.js')) {
            content = applyIfSmaller(content, replaceInJs(content, classMap, sortedVarTokens, idMap))
          }

          let nextBytes = getByteLength(content)
          if (nextBytes >= originalBytes) {
            content = originalContent
            nextBytes = originalBytes
          }

          if (nextBytes < originalBytes) {
            const saved = originalBytes - nextBytes
            fs.writeFileSync(file, content)
            totalSaved += saved
            console.log(`\x1b[32m[mangle-css] ${path.relative(distPath, file)}: saved ${saved} bytes\x1b[0m`)
          }
        }

        console.log(`\x1b[32m[mangle-css] Total saved: ${totalSaved} bytes\x1b[0m`)
        recordSavings('mangle-css', totalSaved)
      }
    }
  }
}

function processCSS (css, varTokens, cssClassMap, cssIdMap) {
  let res = css

  if (cssClassMap.size > 0) {
    res = applyIfSmaller(res, replaceCssClasses(res, cssClassMap))
  }

  if (cssIdMap.size > 0) {
    res = applyIfSmaller(res, replaceCssIds(res, cssIdMap))
  }

  if (varTokens.length > 0) {
    let replaced = res
    for (const [o, s] of varTokens) {
      replaced = replaced.split(o).join(s)
    }
    res = applyIfSmaller(res, replaced)
  }

  res = applyIfSmaller(res, flattenStaticCalcs(res))
  res = applyIfSmaller(res, convertOklchToHex(res))

  // Minify safely
  res = applyIfSmaller(res, minifyCss(res))

  return res
}

function minifyCss (css) {
  let res = css
  res = res.replace(/\/\*[\s\S]*?\*\//g, '')
  res = res.replace(/\s*([{}:;,])\s*/g, '$1')
  res = res.replace(/;}/g, '}')
  res = res.replace(/\n/g, '')
  return res
}

function minifyHtml (html) {
  let res = html
  res = res.replace(/>\s+</g, '><')
  res = res.replace(/<!--[\s\S]*?-->/g, '')
  res = res.replace(/\s+/g, ' ')
  return res
}

function flattenStaticCalcs (css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const idx = css.indexOf('calc(', i)
    if (idx === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, idx)

    const start = idx + 5
    let depth = 1
    let j = start
    while (j < css.length && depth > 0) {
      if (css[j] === '(') depth++
      else if (css[j] === ')') depth--
      j++
    }
    if (depth !== 0) {
      out += css.slice(idx)
      break
    }

    const inner = css.slice(start, j - 1)
    const replacement = tryEvaluateCalc(inner)
    const original = css.slice(idx, j)
    if (replacement) {
      out += applyIfSmaller(original, replacement)
    } else {
      out += original
    }
    i = j
  }
  return out
}

function tryEvaluateCalc (expr) {
  if (/var\s*\(/i.test(expr)) return null
  if (/env\s*\(/i.test(expr)) return null
  if (/min\s*\(|max\s*\(|clamp\s*\(/i.test(expr)) return null
  if (/calc\s*\(/i.test(expr)) return null

  const tokens = tokenizeCalc(expr)
  if (!tokens) return null

  let index = 0
  function peek () { return tokens[index] }
  function next () { return tokens[index++] }

  function parseExpression () {
    let left = parseTerm()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      const right = parseTerm()
      left = applyOp(left, op, right)
      if (!left) return null
    }
    return left
  }

  function parseTerm () {
    let left = parseFactor()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value
      const right = parseFactor()
      left = applyOp(left, op, right)
      if (!left) return null
    }
    return left
  }

  function parseFactor () {
    const token = peek()
    if (!token) return null
    if (token.type === 'op' && (token.value === '+' || token.value === '-')) {
      const op = next().value
      const value = parseFactor()
      if (!value) return null
      if (op === '-') {
        return { value: negateRational(value.value), unit: value.unit }
      }
      return value
    }
    if (token.type === 'paren' && token.value === '(') {
      next()
      const inner = parseExpression()
      const closing = next()
      if (!inner || !closing || closing.type !== 'paren' || closing.value !== ')') return null
      return inner
    }
    if (token.type === 'number') {
      next()
      return { value: token.value, unit: token.unit }
    }
    return null
  }

  const parsed = parseExpression()
  if (!parsed) return null
  if (index !== tokens.length) return null

  const formatted = formatDimension(parsed)
  if (!formatted) return null
  return formatted
}

function tokenizeCalc (expr) {
  const tokens = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch })
      i++
      continue
    }

    const num = readNumberWithUnit(expr, i)
    if (!num) return null
    tokens.push({ type: 'number', value: num.value, unit: num.unit })
    i = num.end
  }
  return tokens
}

function readNumberWithUnit (str, start) {
  let i = start
  let sawDigit = false
  if (str[i] === '.') {
    i++
    while (i < str.length && /\d/.test(str[i])) {
      sawDigit = true
      i++
    }
    if (!sawDigit) return null
  } else {
    while (i < str.length && /\d/.test(str[i])) {
      sawDigit = true
      i++
    }
    if (i < str.length && str[i] === '.') {
      i++
      while (i < str.length && /\d/.test(str[i])) {
        i++
      }
    }
  }

  if (!sawDigit) return null
  const numStr = str.slice(start, i)
  let unit = ''
  while (i < str.length && /[a-zA-Z%]/.test(str[i])) {
    unit += str[i]
    i++
  }
  const value = parseRational(numStr)
  if (!value) return null
  return { value, unit, end: i }
}

function applyOp (left, op, right) {
  if (!left || !right) return null
  if (op === '+' || op === '-') {
    if (left.unit !== right.unit) return null
    const res = op === '+' ? addRational(left.value, right.value) : subRational(left.value, right.value)
    return { value: res, unit: left.unit }
  }
  if (op === '*') {
    if (left.unit && right.unit) return null
    const res = mulRational(left.value, right.value)
    return { value: res, unit: left.unit || right.unit }
  }
  if (op === '/') {
    if (right.unit) return null
    const res = divRational(left.value, right.value)
    if (!res) return null
    return { value: res, unit: left.unit }
  }
  return null
}

function parseRational (numStr) {
  let sign = 1n
  let str = numStr
  if (str.startsWith('-')) {
    sign = -1n
    str = str.slice(1)
  } else if (str.startsWith('+')) {
    str = str.slice(1)
  }
  if (!str) return null

  if (str.includes('.')) {
    const parts = str.split('.')
    const intPart = parts[0] === '' ? '0' : parts[0]
    const fracPart = parts[1] || ''
    if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return null
    const scale = 10n ** BigInt(fracPart.length)
    const full = (BigInt(intPart) * scale) + BigInt(fracPart || '0')
    return reduceRational({ num: sign * full, den: scale })
  }

  if (!/^\d+$/.test(str)) return null
  return { num: sign * BigInt(str), den: 1n }
}

function reduceRational (r) {
  if (r.num === 0n) return { num: 0n, den: 1n }
  const g = gcd(absBigInt(r.num), r.den)
  return { num: r.num / g, den: r.den / g }
}

function gcd (a, b) {
  let x = a
  let y = b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function absBigInt (n) {
  return n < 0n ? -n : n
}

function addRational (a, b) {
  const num = a.num * b.den + b.num * a.den
  const den = a.den * b.den
  return reduceRational({ num, den })
}

function subRational (a, b) {
  const num = a.num * b.den - b.num * a.den
  const den = a.den * b.den
  return reduceRational({ num, den })
}

function mulRational (a, b) {
  const num = a.num * b.num
  const den = a.den * b.den
  return reduceRational({ num, den })
}

function divRational (a, b) {
  if (b.num === 0n) return null
  const num = a.num * b.den
  const den = a.den * b.num
  if (den === 0n) return null
  const normalized = den < 0n ? { num: -num, den: -den } : { num, den }
  return reduceRational(normalized)
}

function negateRational (a) {
  return { num: -a.num, den: a.den }
}

function formatDimension (dim) {
  const num = formatRational(dim.value)
  if (!num) return null
  if (num === '0') return '0'
  return num + dim.unit
}

function formatRational (r) {
  if (r.num === 0n) return '0'
  const sign = r.num < 0n ? '-' : ''
  const num = absBigInt(r.num)
  const den = r.den
  if (den === 1n) return sign + num.toString()

  let d = den
  let twos = 0n
  let fives = 0n
  while (d % 2n === 0n) { d /= 2n; twos++ }
  while (d % 5n === 0n) { d /= 5n; fives++ }
  if (d !== 1n) return null

  const scale = twos > fives ? twos : fives
  let scaledNum = num
  for (let i = 0n; i < (scale - twos); i++) scaledNum *= 2n
  for (let i = 0n; i < (scale - fives); i++) scaledNum *= 5n

  const scaleInt = Number(scale)
  const divisor = 10n ** BigInt(scaleInt)
  const intPart = scaledNum / divisor
  let fracPart = (scaledNum % divisor).toString().padStart(scaleInt, '0')
  fracPart = fracPart.replace(/0+$/, '')
  if (!fracPart) return sign + intPart.toString()
  if (intPart === 0n) return sign + '.' + fracPart
  return sign + intPart.toString() + '.' + fracPart
}

function convertOklchToHex (css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const idx = css.indexOf('oklch(', i)
    if (idx === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, idx)

    const start = idx + 6
    let depth = 1
    let j = start
    while (j < css.length && depth > 0) {
      if (css[j] === '(') depth++
      else if (css[j] === ')') depth--
      j++
    }
    if (depth !== 0) {
      out += css.slice(idx)
      break
    }

    const inner = css.slice(start, j - 1)
    const replacement = oklchToHex(inner)
    const original = css.slice(idx, j)
    if (replacement) {
      out += applyIfSmaller(original, replacement)
    } else {
      out += original
    }
    i = j
  }
  return out
}

function oklchToHex (body) {
  const trimmed = body.trim()
  const match = trimmed.match(/^([+-]?\d*\.?\d+%?)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)(deg|rad|turn|grad)?(?:\s*\/\s*([+-]?\d*\.?\d+%?))?$/)
  if (!match) return null

  const lToken = match[1]
  const cToken = match[2]
  const hToken = match[3]
  const hUnit = match[4] || 'deg'
  const aToken = match[5]

  const l = parsePercentOrNumber(lToken, true)
  if (l == null) return null

  const c = parseFloat(cToken)
  if (!Number.isFinite(c)) return null

  let h = parseFloat(hToken)
  if (!Number.isFinite(h)) return null
  h = convertHueToDegrees(h, hUnit)
  if (!Number.isFinite(h)) return null

  const alpha = aToken ? parsePercentOrNumber(aToken, false) : 1
  if (alpha == null) return null

  const rgb = oklchToSrgb(l, c, h)
  if (!rgb) return null

  const hex = rgbToHex(rgb.r, rgb.g, rgb.b, alpha)
  return hex
}

function parsePercentOrNumber (token, allowPercent) {
  if (token.endsWith('%')) {
    if (!allowPercent) return null
    const num = parseFloat(token.slice(0, -1))
    if (!Number.isFinite(num)) return null
    return num / 100
  }
  const num = parseFloat(token)
  if (!Number.isFinite(num)) return null
  if (allowPercent) {
    if (num > 1 && num <= 100) return null
  }
  if (num < 0 || num > 1) return null
  return num
}

function convertHueToDegrees (value, unit) {
  if (unit === 'deg') return value
  if (unit === 'turn') return value * 360
  if (unit === 'grad') return value * 0.9
  if (unit === 'rad') return value * (180 / Math.PI)
  return NaN
}

function oklchToSrgb (l, c, hDeg) {
  const hRad = (hDeg / 180) * Math.PI
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b

  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3

  let rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  let gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  let bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  const eps = 1e-6
  if (
    rLin < -eps || rLin > 1 + eps ||
    gLin < -eps || gLin > 1 + eps ||
    bLin < -eps || bLin > 1 + eps
  ) return null

  rLin = clamp01(rLin)
  gLin = clamp01(gLin)
  bLin = clamp01(bLin)

  const r = linearToSrgb(rLin)
  const g = linearToSrgb(gLin)
  const bVal = linearToSrgb(bLin)

  return { r, g, b: bVal }
}

function linearToSrgb (c) {
  if (c <= 0.0031308) return 12.92 * c
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function clamp01 (v) {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function rgbToHex (r, g, b, alpha) {
  const r8 = toByte(r)
  const g8 = toByte(g)
  const b8 = toByte(b)
  const a8 = alpha != null && alpha < 1 ? toByte(alpha) : null

  const full = '#' + byteToHex(r8) + byteToHex(g8) + byteToHex(b8) + (a8 == null ? '' : byteToHex(a8))
  const short = tryShortHex(r8, g8, b8, a8)
  if (short && getByteLength(short) < getByteLength(full)) return short
  return full
}

function toByte (value) {
  const v = clamp01(value)
  return Math.round(v * 255)
}

function byteToHex (n) {
  return n.toString(16).padStart(2, '0')
}

function tryShortHex (r8, g8, b8, a8) {
  const rh = byteToHex(r8)
  const gh = byteToHex(g8)
  const bh = byteToHex(b8)
  if (a8 == null) {
    if (rh[0] === rh[1] && gh[0] === gh[1] && bh[0] === bh[1]) {
      return '#' + rh[0] + gh[0] + bh[0]
    }
    return null
  }
  const ah = byteToHex(a8)
  if (rh[0] === rh[1] && gh[0] === gh[1] && bh[0] === bh[1] && ah[0] === ah[1]) {
    return '#' + rh[0] + gh[0] + bh[0] + ah[0]
  }
  return null
}

function replaceCssClasses (css, cssClassMap) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch !== '.') {
      out += ch
      i++
      continue
    }

    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      out += ch
      i++
      continue
    }

    const { ident, end } = parsed
    const replacement = cssClassMap.get(ident)
    if (replacement) {
      out += '.' + replacement
    } else {
      out += '.' + ident
    }
    i = end
  }
  return out
}

function replaceCssIds (css, cssIdMap) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch !== '#') {
      out += ch
      i++
      continue
    }

    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      out += ch
      i++
      continue
    }

    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && isHexColorIdent(unescaped)) {
      out += '#' + ident
      i = end
      continue
    }
    const replacement = cssIdMap.get(ident)
    if (replacement) {
      out += '#' + replacement
    } else {
      out += '#' + ident
    }
    i = end
  }
  return out
}

function collectCssClasses (css) {
  const result = []
  const seen = new Set()
  let i = 0
  while (i < css.length) {
    if (css[i] !== '.') {
      i++
      continue
    }
    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      i++
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && !/^\d/.test(unescaped)) {
      if (!seen.has(ident)) {
        seen.add(ident)
        result.push({ escaped: ident, unescaped })
      }
    }
    i = end
  }
  return result
}

function collectCssIds (css) {
  const result = []
  const seen = new Set()
  let i = 0
  while (i < css.length) {
    if (css[i] !== '#') {
      i++
      continue
    }
    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      i++
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && !/^\d/.test(unescaped) && !isHexColorIdent(unescaped)) {
      if (!seen.has(ident)) {
        seen.add(ident)
        result.push({ escaped: ident, unescaped })
      }
    }
    i = end
  }
  return result
}

function countCssClassOccurrences (css, knownClasses, counts) {
  if (!knownClasses || knownClasses.size === 0) return
  let i = 0
  while (i < css.length) {
    if (css[i] !== '.') {
      i++
      continue
    }
    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      i++
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && !/^\d/.test(unescaped) && knownClasses.has(unescaped)) {
      bumpCount(counts, unescaped)
    }
    i = end
  }
}

function countCssIdOccurrences (css, knownIds, counts) {
  if (!knownIds || knownIds.size === 0) return
  let i = 0
  while (i < css.length) {
    if (css[i] !== '#') {
      i++
      continue
    }
    const parsed = readCssIdent(css, i + 1)
    if (!parsed) {
      i++
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && !/^\d/.test(unescaped) && !isHexColorIdent(unescaped) && knownIds.has(unescaped)) {
      bumpCount(counts, unescaped)
    }
    i = end
  }
}

function readCssIdent (css, start) {
  let i = start
  let ident = ''
  while (i < css.length) {
    const ch = css[i]
    if (ch === '\\') {
      const esc = readCssEscape(css, i)
      ident += esc.text
      i += esc.length
      continue
    }
    if (/[a-zA-Z0-9_-]/.test(ch)) {
      ident += ch
      i++
      continue
    }
    break
  }
  if (!ident) return null
  return { ident, end: i }
}

function readCssEscape (css, start) {
  let i = start + 1
  if (i >= css.length) return { text: '\\', length: 1 }
  const hexMatch = css.slice(i, i + 6).match(/^[0-9a-fA-F]{1,6}/)
  if (hexMatch) {
    i += hexMatch[0].length
    if (css[i] === ' ') i++
    return { text: css.slice(start, i), length: i - start }
  }
  i++
  return { text: css.slice(start, i), length: i - start }
}

function unescapeCssIdent (str) {
  return str
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')
}

function cssEscape (value) {
  const string = String(value)
  const length = string.length
  let index = -1
  let codeUnit
  let result = ''
  const firstCodeUnit = string.charCodeAt(0)

  while (++index < length) {
    codeUnit = string.charCodeAt(index)

    if (codeUnit === 0x0000) {
      result += '\uFFFD'
      continue
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001F) ||
      codeUnit === 0x007F ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002D)
    ) {
      result += '\\' + codeUnit.toString(16) + ' '
      continue
    }

    if (index === 0 && codeUnit === 0x002D && length === 1) {
      result += '\\' + string.charAt(index)
      continue
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002D ||
      codeUnit === 0x005F ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007A)
    ) {
      result += string.charAt(index)
      continue
    }

    result += '\\' + string.charAt(index)
  }

  return result
}

const CLASS_TOKEN_RE = /^[!A-Za-z0-9_:\-./%#[\](),=+*&@?<>|~^$]+$/
const CLASS_TOKEN_GLOBAL_RE = /[!A-Za-z0-9_:\-./%#[\](),=+*&@?<>|~^$]+/g
const CLASS_ATTR_RE = /\bclass=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const ID_REF_ATTRS = [
  'for',
  'form',
  'list',
  'headers',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'aria-flowto',
]
const ID_REF_ATTR_RE = new RegExp(
  `(^|[^\\w:-])(${ID_REF_ATTRS.join('|')})=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
  'gi'
)
const ID_ATTR_SELECTOR_RE = /\[id\s*=\s*(['"]?)([^'"\]]+)\1\]/gi
const ID_ATTR_RE = /(^|[^\w:-])id=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

function normalizeClassWhitespace (str) {
  return str.replace(/\\[nrt]/g, ' ')
}

function isClassListString (str, knownClasses) {
  const tokens = normalizeClassWhitespace(str).trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  let hasKnown = false
  for (const token of tokens) {
    if (!CLASS_TOKEN_RE.test(token)) continue
    if (knownClasses.has(token)) hasKnown = true
  }
  return hasKnown
}

function collectClassTokensFromString (str, knownClasses, outSet) {
  if (!str) return
  if (!isClassListString(str, knownClasses)) return
  const tokens = normalizeClassWhitespace(str).trim().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (!CLASS_TOKEN_RE.test(token)) continue
    if (knownClasses.has(token)) outSet.add(token)
  }
}

function replaceClassTokensInString (str, classMap) {
  if (!str || classMap.size === 0) return str
  if (!isClassListString(str, classMap)) return str
  return str.replace(CLASS_TOKEN_GLOBAL_RE, (token) => classMap.get(token) || token)
}

function collectIdTokensFromString (str, knownIds, usedIds, htmlIds) {
  if (!str) return
  const tokens = str.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return
  for (const token of tokens) {
    if (htmlIds) htmlIds.add(token)
    if (knownIds && knownIds.has(token)) {
      usedIds.add(token)
    }
  }
}

function collectIdsFromHashSelectors (str, knownIds, outSet) {
  if (!str || !knownIds || knownIds.size === 0) return
  let i = 0
  while (i < str.length) {
    const idx = str.indexOf('#', i)
    if (idx === -1) break
    const parsed = readCssIdent(str, idx + 1)
    if (!parsed) {
      i = idx + 1
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && !isHexColorIdent(unescaped) && knownIds.has(unescaped)) outSet.add(unescaped)
    i = end
  }
}

function collectIdsFromAttributeSelectors (str, knownIds, outSet) {
  if (!str || !knownIds || knownIds.size === 0) return
  for (const match of str.matchAll(ID_ATTR_SELECTOR_RE)) {
    const token = match[2]
    if (knownIds.has(token)) outSet.add(token)
  }
}

function collectIdsFromSelectorString (str, knownIds, outSet) {
  if (!str) return
  if (knownIds.has(str)) outSet.add(str)
  collectIdsFromHashSelectors(str, knownIds, outSet)
  collectIdsFromAttributeSelectors(str, knownIds, outSet)
}

function isHexColorString (value) {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

function isHexColorIdent (value) {
  return /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

function replaceIdAttributeSelectors (str, idMap) {
  return str.replace(ID_ATTR_SELECTOR_RE, (match, quote, value) => {
    const next = idMap.get(value)
    if (!next) return match
    const q = quote || ''
    return `[id=${q}${next}${q}]`
  })
}

function replaceIdHashSelectors (str, idMap) {
  let out = ''
  let i = 0
  while (i < str.length) {
    const idx = str.indexOf('#', i)
    if (idx === -1) {
      out += str.slice(i)
      break
    }
    out += str.slice(i, idx)
    const parsed = readCssIdent(str, idx + 1)
    if (!parsed) {
      out += '#'
      i = idx + 1
      continue
    }
    const { ident, end } = parsed
    const unescaped = unescapeCssIdent(ident)
    if (unescaped && isHexColorIdent(unescaped)) {
      out += '#' + ident
      i = end
      continue
    }
    const next = idMap.get(unescaped)
    if (next) {
      out += '#' + cssEscape(next)
    } else {
      out += '#' + ident
    }
    i = end
  }
  return out
}

function replaceIdTokensInString (str, idMap) {
  if (!str || idMap.size === 0) return str
  if (isHexColorString(str)) return str

  if (idMap.has(str)) return idMap.get(str)

  let res = str
  res = replaceIdAttributeSelectors(res, idMap)
  res = replaceIdHashSelectors(res, idMap)

  return res
}

function replaceIdList (value, idMap) {
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return value
  let changed = false
  const replaced = tokens.map((token) => {
    const next = idMap.get(token)
    if (next) {
      changed = true
      return next
    }
    return token
  })
  return changed ? replaced.join(' ') : value
}

function replaceHtmlIdReferences (html, idMap) {
  if (!idMap || idMap.size === 0) return html
  let res = html

  res = res.replace(ID_ATTR_RE, (match, prefix, dq, sq, uq) => {
    const value = dq ?? sq ?? uq ?? ''
    const replaced = replaceIdList(value, idMap)
    if (dq != null) return `${prefix}id="${replaced}"`
    if (sq != null) return `${prefix}id='${replaced}'`
    return `${prefix}id=${replaced}`
  })

  res = res.replace(ID_REF_ATTR_RE, (match, prefix, attr, dq, sq, uq) => {
    const value = dq ?? sq ?? uq ?? ''
    const replaced = replaceIdList(value, idMap)
    if (dq != null) return `${prefix}${attr}="${replaced}"`
    if (sq != null) return `${prefix}${attr}='${replaced}'`
    return `${prefix}${attr}=${replaced}`
  })

  res = res.replace(/\b(xlink:href|href)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, attr, dq, sq, uq) => {
    const value = dq ?? sq ?? uq ?? ''
    if (!value.startsWith('#')) return match
    const next = idMap.get(value.slice(1))
    if (!next) return match
    const replaced = `#${next}`
    if (dq != null) return `${attr}="${replaced}"`
    if (sq != null) return `${attr}='${replaced}'`
    return `${attr}=${replaced}`
  })

  res = res.replace(/url\(\s*(['"])?#([^'")\s]+)\1\s*\)/gi, (match, quote, value) => {
    const next = idMap.get(value)
    if (!next) return match
    const q = quote || ''
    return `url(${q}#${next}${q})`
  })

  return res
}

function replaceLiteralContent (str, classMap, varTokens, idMap) {
  let res = str
  if (varTokens.length > 0) {
    for (const [o, s] of varTokens) {
      res = res.split(o).join(s)
    }
  }
  if (classMap.size > 0) {
    res = replaceClassTokensInString(res, classMap)
  }
  if (idMap && idMap.size > 0) {
    res = replaceIdTokensInString(res, idMap)
  }
  return res
}

function replaceInJs (code, classMap, varTokens, idMap) {
  if (classMap.size === 0 && varTokens.length === 0 && (!idMap || idMap.size === 0)) return code
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
      const res = readJsString(code, i, classMap, varTokens, idMap)
      out += res.text
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplate(code, i, classMap, varTokens, idMap)
      out += res.text
      i = res.end
      continue
    }

    out += ch
    i++
  }
  return out
}

function collectUsedClassesFromJs (code, knownClasses, outSet) {
  let i = 0
  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) return
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) return
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const res = readJsStringValue(code, i)
      collectClassTokensFromString(res.value, knownClasses, outSet)
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplateValues(code, i, knownClasses, outSet)
      i = res.end
      continue
    }

    i++
  }
}

function collectUsedIdsFromJs (code, knownIds, outSet) {
  if (!knownIds || knownIds.size === 0) return
  let i = 0
  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) return
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) return
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const res = readJsStringValue(code, i)
      collectIdsFromSelectorString(res.value, knownIds, outSet)
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplateValuesForIds(code, i, knownIds, outSet)
      i = res.end
      continue
    }

    i++
  }
}

function readJsString (code, start, classMap, varTokens, idMap) {
  const quote = code[start]
  let i = start + 1
  let value = ''
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      value += ch + (code[i + 1] || '')
      i += 2
      continue
    }
    if (ch === quote) break
    value += ch
    i++
  }
  const replaced = replaceLiteralContent(value, classMap, varTokens, idMap)
  return { text: quote + replaced + quote, end: Math.min(i + 1, code.length) }
}

function readJsStringValue (code, start) {
  const quote = code[start]
  let i = start + 1
  let value = ''
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      value += ch + (code[i + 1] || '')
      i += 2
      continue
    }
    if (ch === quote) break
    value += ch
    i++
  }
  return { value, end: Math.min(i + 1, code.length) }
}

function readJsTemplate (code, start, classMap, varTokens, idMap) {
  let i = start + 1
  let out = '`'
  let segment = ''

  while (i < code.length) {
    const ch = code[i]

    if (ch === '\\') {
      segment += ch + (code[i + 1] || '')
      i += 2
      continue
    }

    if (ch === '`') {
      out += replaceLiteralContent(segment, classMap, varTokens, idMap)
      out += '`'
      return { text: out, end: i + 1 }
    }

    if (ch === '$' && code[i + 1] === '{') {
      out += replaceLiteralContent(segment, classMap, varTokens, idMap)
      segment = ''
      out += '${'
      i += 2
      const expr = readJsTemplateExpression(code, i, classMap, varTokens, idMap)
      out += expr.text
      i = expr.end
      continue
    }

    segment += ch
    i++
  }

  out += replaceLiteralContent(segment, classMap, varTokens, idMap)
  return { text: out, end: i }
}

function readJsTemplateValues (code, start, knownClasses, outSet) {
  let i = start + 1
  let segment = ''
  while (i < code.length) {
    const ch = code[i]

    if (ch === '\\') {
      segment += ch + (code[i + 1] || '')
      i += 2
      continue
    }

    if (ch === '`') {
      collectClassTokensFromString(segment, knownClasses, outSet)
      return { end: i + 1 }
    }

    if (ch === '$' && code[i + 1] === '{') {
      collectClassTokensFromString(segment, knownClasses, outSet)
      segment = ''
      i += 2
      const expr = readJsTemplateExpressionValues(code, i, knownClasses, outSet)
      i = expr.end
      continue
    }

    segment += ch
    i++
  }
  collectClassTokensFromString(segment, knownClasses, outSet)
  return { end: i }
}

function readJsTemplateValuesForIds (code, start, knownIds, outSet) {
  let i = start + 1
  let segment = ''
  while (i < code.length) {
    const ch = code[i]

    if (ch === '\\') {
      segment += ch + (code[i + 1] || '')
      i += 2
      continue
    }

    if (ch === '`') {
      collectIdsFromSelectorString(segment, knownIds, outSet)
      return { end: i + 1 }
    }

    if (ch === '$' && code[i + 1] === '{') {
      collectIdsFromSelectorString(segment, knownIds, outSet)
      segment = ''
      i += 2
      const expr = readJsTemplateExpressionValuesForIds(code, i, knownIds, outSet)
      i = expr.end
      continue
    }

    segment += ch
    i++
  }
  collectIdsFromSelectorString(segment, knownIds, outSet)
  return { end: i }
}

function readJsTemplateExpression (code, start, classMap, varTokens, idMap) {
  let i = start
  let out = ''
  let depth = 1

  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) {
        out += code.slice(i)
        return { text: out, end: code.length }
      }
      out += code.slice(i, end + 1)
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) {
        out += code.slice(i)
        return { text: out, end: code.length }
      }
      out += code.slice(i, end + 2)
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const res = readJsString(code, i, classMap, varTokens, idMap)
      out += res.text
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplate(code, i, classMap, varTokens, idMap)
      out += res.text
      i = res.end
      continue
    }

    if (ch === '{') {
      depth++
      out += ch
      i++
      continue
    }

    if (ch === '}') {
      depth--
      out += ch
      i++
      if (depth === 0) break
      continue
    }

    out += ch
    i++
  }

  return { text: out, end: i }
}

function readJsTemplateExpressionValues (code, start, knownClasses, outSet) {
  let i = start
  let depth = 1

  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) return { end: code.length }
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) return { end: code.length }
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const res = readJsStringValue(code, i)
      collectClassTokensFromString(res.value, knownClasses, outSet)
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplateValues(code, i, knownClasses, outSet)
      i = res.end
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
      if (depth === 0) break
      continue
    }

    i++
  }

  return { end: i }
}

function readJsTemplateExpressionValuesForIds (code, start, knownIds, outSet) {
  let i = start
  let depth = 1

  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2)
      if (end === -1) return { end: code.length }
      i = end + 1
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) return { end: code.length }
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const res = readJsStringValue(code, i)
      collectIdsFromSelectorString(res.value, knownIds, outSet)
      i = res.end
      continue
    }

    if (ch === '`') {
      const res = readJsTemplateValuesForIds(code, i, knownIds, outSet)
      i = res.end
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
      if (depth === 0) break
      continue
    }

    i++
  }

  return { end: i }
}

export default mangleCSS
