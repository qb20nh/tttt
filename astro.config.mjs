import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import playformInline from '@playform/inline'
import compress from '@playform/compress'
import { cssMangle } from './astro-plugins/astro-css-mangle.js'
import { optimizeShader } from './astro-plugins/astro-optimize-shader.js'
import { optimizeLicense } from './astro-plugins/astro-optimize-license.js'

// https://astro.build/config
export default defineConfig({
  prefetch: true,
  base: '/tttt/',
  output: 'static',
  integrations: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    playformInline({
      Beasties: {
        path: './dist',
        publicPath: '/tttt/',
      },
    }),
    compress(),
    cssMangle(),
    optimizeShader(),
    optimizeLicense(),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
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
