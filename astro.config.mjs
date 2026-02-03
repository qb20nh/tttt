import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import playformInline from '@playform/inline'

// https://astro.build/config
export default defineConfig({
  site: 'https://cash.github.io',
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
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
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
