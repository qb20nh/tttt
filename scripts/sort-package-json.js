import fs from 'node:fs'

const pkgPath = 'package.json'
try {
  const content = fs.readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(content)

  const sortDeps = (deps) => {
    if (!deps) return deps
    return Object.keys(deps).sort().reduce((acc, key) => {
      acc[key] = deps[key]
      return acc
    }, {})
  }

  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].forEach(key => {
    if (pkg[key]) {
      pkg[key] = sortDeps(pkg[key])
    }
  })

  // Canonical order based on https://docs.npmjs.com/cli/v11/configuring-npm/package-json
  const standardKeysTop = [
    'name',
    'version',
    'description',
    'keywords',
    'homepage',
    'bugs',
    'license',
    'author',
    'contributors',
    'funding',
    'files',
    'exports',
    'main',
    'type',
    'browser',
    'bin',
    'man',
    'directories',
    'repository',
    'scripts',
    'config'
  ]

  const dependencyKeys = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'bundleDependencies',
    'optionalDependencies'
  ]

  const standardKeysBottom = [
    'overrides',
    'engines',
    'packageManager',
    'os',
    'cpu',
    'libc',
    'devEngines',
    'private',
    'publishConfig',
    'workspaces',
  ]

  const sortedPkg = {}

  // 1. Top-level standard keys
  standardKeysTop.forEach(key => {
    if (key in pkg) {
      sortedPkg[key] = pkg[key]
      delete pkg[key]
    }
  })

  // 2. External keys (alphabetical) - everything else except deps and bottom keys
  const remainingKeys = Object.keys(pkg).filter(key =>
    !dependencyKeys.includes(key) && !standardKeysBottom.includes(key)
  ).sort()

  remainingKeys.forEach(key => {
    sortedPkg[key] = pkg[key]
    delete pkg[key]
  })

  // 3. Dependencies
  dependencyKeys.forEach(key => {
    if (key in pkg) { // Check original pkg or what's left? We haven't deleted dep keys yet
      // Actually we should access from original object reference if we didn't delete,
      // but here we are checking `pkg` which still has them.
      // However, to be safe and consistent with previous blocks:
      sortedPkg[key] = pkg[key]
      delete pkg[key]
    }
  })

  // 4. Bottom-level standard keys
  standardKeysBottom.forEach(key => {
    if (key in pkg) {
      sortedPkg[key] = pkg[key]
      delete pkg[key]
    }
  })

  // 5. Anything strictly remaining? (Should be none if filters were correct, but just in case)
  Object.keys(pkg).sort().forEach(key => {
    sortedPkg[key] = pkg[key]
  })

  const newContent = JSON.stringify(sortedPkg, null, 2) + '\n'
  if (content !== newContent) {
    fs.writeFileSync(pkgPath, newContent)
    console.log('Sorted package.json dependencies')
  }
} catch (error) {
  console.error('Failed to sort package.json:', error)
  process.exit(1)
}
