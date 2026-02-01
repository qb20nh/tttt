import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { runBenchmark } from './game/benchmark'

declare global {
  interface Window {
    runAiBenchmark: typeof runBenchmark;
  }
}

window.runAiBenchmark = runBenchmark;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
