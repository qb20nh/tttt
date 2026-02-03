import { WebGLRenderer } from 'three'

let rendererInstance: WebGLRenderer | null = null

export const getRenderer = (): WebGLRenderer => {
  if (!rendererInstance) {
    rendererInstance = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
      // stencil: false, // Optional optimization if not using stencil buffer
      // depth: false, // We assume Orthographic 2D usage mostly? No, Scene3D uses depth sorting (z=1). Keep default.
    })

    rendererInstance.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // We generally shouldn't setSize here as it depends on container,
    // but setting a default prevents 0x0 issues.
    rendererInstance.setSize(window.innerWidth, window.innerHeight)
  }
  return rendererInstance
}

export const disposeRenderer = () => {
  if (rendererInstance) {
    rendererInstance.dispose()
    rendererInstance = null
  }
}
