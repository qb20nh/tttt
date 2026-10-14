import WorkerCtor from './worker?worker'

const MAX_WORKERS = 2
const workers: Worker[] = []
const inUse = new Set<Worker>()
const pendingRequests = new WeakMap<Worker, number>()

const createWorker = () => {
  const worker = new WorkerCtor()
  const postMessage = worker.postMessage.bind(worker)
  pendingRequests.set(worker, 0)
  worker.postMessage = (message: unknown, options?: Transferable[] | StructuredSerializeOptions) => {
    const isSearch = typeof message === 'object' && message !== null &&
      'type' in message && (message.type === 'search' || message.type === 'benchmark')
    if (isSearch) pendingRequests.set(worker, (pendingRequests.get(worker) ?? 0) + 1)
    try {
      if (Array.isArray(options)) postMessage(message, options)
      else postMessage(message, options)
    } catch (error) {
      if (isSearch) pendingRequests.set(worker, (pendingRequests.get(worker) ?? 1) - 1)
      throw error
    }
  }
  worker.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'result' || event.data?.type === 'benchmark_result') {
      pendingRequests.set(worker, Math.max(0, (pendingRequests.get(worker) ?? 0) - 1))
    }
  })
  workers.push(worker)
  return worker
}

export const preloadAiWorkers = () => {
  if (workers.length === 0) createWorker()
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
  // A synchronous search cannot consume a cancellation message until it ends.
  // Terminate abandoned searches so their responses cannot reach a new owner.
  if ((pendingRequests.get(worker) ?? 0) > 0) {
    worker.terminate()
    pendingRequests.delete(worker)
    const index = workers.indexOf(worker)
    if (index !== -1) workers.splice(index, 1)
  }
}

export const clearAiWorkers = () => {
  for (const worker of workers) {
    worker.postMessage({ type: 'clear' })
  }
}
