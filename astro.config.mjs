import { defineConfig } from 'astro/config'
import preact from '@astrojs/preact'
import tailwindcss from '@tailwindcss/vite'
import playformInline from '@playform/inline'
import compress from '@playform/compress'
import { mangleCSS } from './astro-plugins/astro-mangle-css.js'
import { optimizeShader } from './astro-plugins/astro-optimize-shader.js'
import { optimizeLicense } from './astro-plugins/astro-optimize-license.js'
import { pruneUnusedAssets } from './astro-plugins/astro-prune-unused-assets.js'
import { mangleFilenames } from './astro-plugins/astro-mangle-filenames.js'
import { mangleAstroCids } from './astro-plugins/astro-mangle-astro-cids.js'
import { withReportSavings } from './astro-plugins/astro-report-savings.js'
import { visualizer } from 'rollup-plugin-visualizer'

// https://astro.build/config
export default defineConfig({
  prefetch: true,
  base: '/tttt/',
  output: 'static',
  integrations: [
    preact({
      compat: true,
      reactAliasesEnabled: true,
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '18' }]],
      },
    }),
    playformInline({
      Beasties: {
        path: './dist',
        publicPath: '/tttt/',
        preload: 'swap',
        inlineThreshold: 30000,
        noscriptFallback: true,
      },
    }),
    compress(),
    withReportSavings([
      mangleCSS(),
      optimizeShader(),
      optimizeLicense(),
      mangleAstroCids(),
      mangleFilenames(),
      pruneUnusedAssets(),
    ]),
  ],
  vite: {
    resolve: {
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react-dom/test-utils': 'preact/test-utils',
        'react/jsx-runtime': 'preact/jsx-runtime',
        'react/compiler-runtime': 'react-compiler-runtime',
      },
    },
    plugins: [
      tailwindcss(),
      !process.env.CI &&
      visualizer({
        emitFile: true,
        filename: 'stats.html',
      }),
    ].filter(Boolean),
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'preact-vendor': ['preact', 'preact/compat'],
          },
        },
      },
    },
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  },
})
