export function fixPreloadAttributes () {
  return {
    name: 'fixup-preload-attributes',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const fs = await import('node:fs/promises')
        const path = await import('node:path')
        const { fileURLToPath } = await import('node:url')
        const glob = (await import('fast-glob')).default

        const distDir = fileURLToPath(dir)
        const htmlFiles = await glob('**/*.html', { cwd: distDir })

        for (const file of htmlFiles) {
          const filePath = path.join(distDir, file)
          let content = await fs.readFile(filePath, 'utf-8')

          // Regex to find the broken preload link and add as="style"
          // Looks for rel="alternate stylesheet preload" and inserts as="style"
          const regex = /(<link[^>]+rel=["']alternate stylesheet preload["'])([^>]*>)/g

          if (regex.test(content)) {
            console.log(`[fixup-preload-attributes] Fixing ${file}`)
            content = content.replace(regex, '$1 as="style"$2')
            await fs.writeFile(filePath, content, 'utf-8')
          }
        }
      },
    },
  }
}
