import WorkerCtor from './worker?worker'

const MAX_WORKERS = 2
const workers: Worker[] = []
const inUse = new Set<Worker>()

const createWorker = () => {
  const worker = new WorkerCtor()
  workers.push(worker)
  return worker
}

export const preloadAiWorkers = () => {
  while (workers.length < MAX_WORKERS) {
    createWorker()
  }
}

export const acquireAiWorker = (): Worker | null => {
  for (const worker of workers) {
    if (!inUse.has(worker)) {
      inUse.add(worker)
      return worker
    }
  }

  if (workers.length < MAX_WORKERS) {
    const worker = createWorker()
    inUse.add(worker)
    return worker
  }

  return null
}

export const releaseAiWorker = (worker: Worker | null) => {
  if (!worker) return
  inUse.delete(worker)
  worker.onmessage = null
}

export const clearAiWorkers = () => {
  for (const worker of workers) {
    worker.postMessage({ type: 'clear' })
  }
}
