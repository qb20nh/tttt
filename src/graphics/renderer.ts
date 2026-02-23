import { BOARD_SIZE } from '../game/constants'
import { vertexShader, fragmentShader } from './shaders'

type ParallelCompileExtension = {
  COMPLETION_STATUS_KHR: number
}

export type RendererProfile = 'strict' | 'balanced' | 'compat'

export type RendererInitStatus =
  | { ok: true; profile: RendererProfile }
  | { ok: false; reason: string }

type RendererContextProfile = {
  profile: RendererProfile
  attributes: {
    antialias: boolean
    preserveDrawingBuffer: boolean
    powerPreference: WebGLPowerPreference
  }
}

const CONTEXT_PROFILES: RendererContextProfile[] = [
  {
    profile: 'strict',
    attributes: {
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    },
  },
  {
    profile: 'balanced',
    attributes: {
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    },
  },
  {
    profile: 'compat',
    attributes: {
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    },
  },
]

class RendererInitError extends Error {
  attemptedProfiles: RendererProfile[]
  webgl2ApiAvailable: boolean

  constructor (
    attemptedProfiles: RendererProfile[],
    webgl2ApiAvailable: boolean
  ) {
    const profileList = attemptedProfiles.join(', ')
    const reason = webgl2ApiAvailable
      ? `Failed to create WebGL2 context (profiles tried: ${profileList}).`
      : 'WebGL2 API is unavailable in this browser.'
    super(reason)
    this.name = 'RendererInitError'
    this.attemptedProfiles = attemptedProfiles
    this.webgl2ApiAvailable = webgl2ApiAvailable
  }
}

const resolveWebGL2Context = (
  canvas: HTMLCanvasElement
): { gl: WebGL2RenderingContext; profile: RendererProfile } => {
  const attemptedProfiles: RendererProfile[] = []
  for (const profile of CONTEXT_PROFILES) {
    attemptedProfiles.push(profile.profile)
    const gl = canvas.getContext('webgl2', profile.attributes)
    if (gl) {
      return { gl, profile: profile.profile }
    }
  }

  const webgl2ApiAvailable = typeof window !== 'undefined' &&
    typeof window.WebGL2RenderingContext !== 'undefined'
  throw new RendererInitError(attemptedProfiles, webgl2ApiAvailable)
}

const getInitReason = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

export interface RenderState {
  time: number
  hover: { x: number; y: number }
  constraint: { x: number; y: number; w: number; h: number }
  player: number
  depth: number
  constraintLevel: number
  gameOver: number
}

const buildViewMatrix = (scale: number, offsetX: number, offsetY: number) => {
  return new Float32Array([
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, 1, 0,
    offsetX, offsetY, 0, 1,
  ])
}

type PendingProgram = {
  program: WebGLProgram
  vertex: WebGLShader
  fragment: WebGLShader
}

const createShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) => {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

const createPendingProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): PendingProgram => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    throw new Error('Failed to create shader program')
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  return { program, vertex, fragment }
}

export class GameRenderer {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  profile: RendererProfile
  program: WebGLProgram | null
  texture: WebGLTexture
  textureScale: number
  useFloatTexture: boolean

  private programState: 'idle' | 'compiling' | 'ready' | 'error'
  private programError: Error | null
  private pendingProgram: PendingProgram | null
  private parallelCompile: ParallelCompileExtension | null
  private readyResolvers: Array<() => void>
  private errorResolvers: Array<(error: Error) => void>
  private pendingProjection: { x: number; y: number } | null
  private pendingView: { scale: number; offsetX: number; offsetY: number } | null

  private positionLocation: number | null
  private uvLocation: number | null

  private uniforms: {
    projectionMatrix: WebGLUniformLocation
    modelViewMatrix: WebGLUniformLocation
    stateTexture: WebGLUniformLocation
    hover: WebGLUniformLocation
    constraint: WebGLUniformLocation
    player: WebGLUniformLocation
    time: WebGLUniformLocation
    depth: WebGLUniformLocation
    constraintLevel: WebGLUniformLocation
    gameOver: WebGLUniformLocation
  } | null

  private buffer: WebGLBuffer

  constructor (canvas: HTMLCanvasElement) {
    const { gl, profile } = resolveWebGL2Context(canvas)

    this.canvas = canvas
    this.gl = gl
    this.profile = profile
    this.program = null
    this.programState = 'idle'
    this.programError = null
    this.pendingProgram = null
    this.parallelCompile = null
    this.readyResolvers = []
    this.errorResolvers = []
    this.pendingProjection = null
    this.pendingView = null

    this.positionLocation = null
    this.uvLocation = null
    this.uniforms = null

    this.useFloatTexture = true
    this.textureScale = 1

    const buffer = gl.createBuffer()
    if (!buffer) {
      throw new Error('Failed to create vertex buffer')
    }
    this.buffer = buffer

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const vertices = new Float32Array([
      -1, -1, 0, 0, 0,
      1, -1, 0, 1, 0,
      1, 1, 0, 1, 1,
      -1, 1, 0, 0, 1,
    ])
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create texture')
    }

    this.texture = texture

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    let internalFormat = gl.RGBA32F
    let textureType = gl.FLOAT
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      BOARD_SIZE,
      BOARD_SIZE,
      0,
      gl.RGBA,
      textureType,
      null
    )
    if (gl.getError() !== gl.NO_ERROR) {
      this.useFloatTexture = false
      this.textureScale = 255
      internalFormat = gl.RGBA8
      textureType = gl.UNSIGNED_BYTE
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internalFormat,
        BOARD_SIZE,
        BOARD_SIZE,
        0,
        gl.RGBA,
        textureType,
        null
      )
    }

    gl.clearColor(0, 0, 0, 1)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    // Set initial canvas styles
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    canvas.style.cursor = 'crosshair'
  }

  private handleProgramError (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    this.programState = 'error'
    this.programError = err

    if (this.pendingProgram) {
      this.gl.deleteProgram(this.pendingProgram.program)
      this.gl.deleteShader(this.pendingProgram.vertex)
      this.gl.deleteShader(this.pendingProgram.fragment)
      this.pendingProgram = null
    }

    if (this.program) {
      this.gl.deleteProgram(this.program)
      this.program = null
    }

    const rejectors = this.errorResolvers
    this.errorResolvers = []
    this.readyResolvers = []
    for (const reject of rejectors) {
      reject(err)
    }

    console.error(err)
  }

  private finalizeProgram (pending: PendingProgram) {
    const gl = this.gl

    const vertexOk = gl.getShaderParameter(pending.vertex, gl.COMPILE_STATUS)
    if (!vertexOk) {
      const info = gl.getShaderInfoLog(pending.vertex)
      throw new Error(`Vertex shader compile failed: ${info}`)
    }

    const fragmentOk = gl.getShaderParameter(
      pending.fragment,
      gl.COMPILE_STATUS
    )
    if (!fragmentOk) {
      const info = gl.getShaderInfoLog(pending.fragment)
      throw new Error(`Fragment shader compile failed: ${info}`)
    }

    const linkOk = gl.getProgramParameter(
      pending.program,
      gl.LINK_STATUS
    )
    if (!linkOk) {
      const info = gl.getProgramInfoLog(pending.program)
      throw new Error(`Program link failed: ${info}`)
    }

    gl.deleteShader(pending.vertex)
    gl.deleteShader(pending.fragment)

    const positionLocation = gl.getAttribLocation(pending.program, 'position')
    const uvLocation = gl.getAttribLocation(pending.program, 'uv')

    const projectionMatrix = gl.getUniformLocation(
      pending.program,
      'projectionMatrix'
    )
    const modelViewMatrix = gl.getUniformLocation(
      pending.program,
      'modelViewMatrix'
    )
    const stateTexture = gl.getUniformLocation(
      pending.program,
      'uStateTexture'
    )
    const hover = gl.getUniformLocation(pending.program, 'uHover')
    const constraint = gl.getUniformLocation(pending.program, 'uConstraint')
    const player = gl.getUniformLocation(pending.program, 'uPlayer')
    const time = gl.getUniformLocation(pending.program, 'uTime')
    const depth = gl.getUniformLocation(pending.program, 'uDepth')
    const constraintLevel = gl.getUniformLocation(
      pending.program,
      'uConstraintLevel'
    )
    const gameOver = gl.getUniformLocation(pending.program, 'uGameOver')

    if (
      !projectionMatrix ||
      !modelViewMatrix ||
      !stateTexture ||
      !hover ||
      !constraint ||
      !player ||
      !time ||
      !depth ||
      !constraintLevel ||
      !gameOver
    ) {
      throw new Error('Failed to resolve shader uniforms')
    }

    this.program = pending.program
    this.positionLocation = positionLocation
    this.uvLocation = uvLocation
    this.uniforms = {
      projectionMatrix,
      modelViewMatrix,
      stateTexture,
      hover,
      constraint,
      player,
      time,
      depth,
      constraintLevel,
      gameOver,
    }

    gl.useProgram(pending.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 20, 0)

    gl.enableVertexAttribArray(uvLocation)
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 20, 12)

    gl.uniform1i(this.uniforms.stateTexture, 0)

    const projection = this.pendingProjection ?? { x: 1, y: 1 }
    const projectionValues = new Float32Array([
      projection.x, 0, 0, 0,
      0, projection.y, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ])
    gl.uniformMatrix4fv(
      this.uniforms.projectionMatrix,
      false,
      projectionValues
    )

    const view = this.pendingView ?? { scale: 1, offsetX: 0, offsetY: 0 }
    const viewMatrix = buildViewMatrix(view.scale, view.offsetX, view.offsetY)
    gl.uniformMatrix4fv(
      this.uniforms.modelViewMatrix,
      false,
      viewMatrix
    )

    this.programState = 'ready'
    this.programError = null
    this.pendingProgram = null

    const resolvers = this.readyResolvers
    this.readyResolvers = []
    this.errorResolvers = []
    for (const resolve of resolvers) {
      resolve()
    }
  }

  private tryFinalizeProgram () {
    if (this.programState !== 'compiling' || !this.pendingProgram) {
      return false
    }

    if (this.parallelCompile) {
      const completed = this.gl.getProgramParameter(
        this.pendingProgram.program,
        this.parallelCompile.COMPLETION_STATUS_KHR
      )
      if (!completed) {
        return false
      }
    }

    try {
      this.finalizeProgram(this.pendingProgram)
      return true
    } catch (error) {
      this.handleProgramError(error)
      return false
    }
  }

  startProgramCompile () {
    if (this.programState !== 'idle') return

    this.programState = 'compiling'
    this.parallelCompile = this.gl.getExtension(
      'KHR_parallel_shader_compile'
    ) as ParallelCompileExtension | null

    try {
      this.pendingProgram = createPendingProgram(
        this.gl,
        vertexShader,
        fragmentShader
      )

      if (!this.parallelCompile) {
        this.finalizeProgram(this.pendingProgram)
      } else {
        this.tryFinalizeProgram()
      }
    } catch (error) {
      this.handleProgramError(error)
    }
  }

  ensureProgramReady () {
    if (this.programState === 'ready') return true
    if (this.programState === 'compiling') {
      return this.tryFinalizeProgram()
    }
    return false
  }

  isReady () {
    return this.programState === 'ready'
  }

  whenReady () {
    if (this.programState === 'ready') {
      return Promise.resolve()
    }
    if (this.programState === 'error') {
      return Promise.reject(
        this.programError ?? new Error('Shader program failed to compile')
      )
    }
    return new Promise<void>((resolve, reject) => {
      this.readyResolvers.push(resolve)
      this.errorResolvers.push(reject)
    })
  }

  setSize (width: number, height: number, pixelRatio: number) {
    const nextWidth = Math.max(1, Math.floor(width * pixelRatio))
    const nextHeight = Math.max(1, Math.floor(height * pixelRatio))
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth
      this.canvas.height = nextHeight
    }
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  setProjection (scaleX: number, scaleY: number) {
    this.pendingProjection = { x: scaleX, y: scaleY }
    if (!this.ensureProgramReady() || !this.uniforms || !this.program) {
      return
    }
    const projectionMatrix = new Float32Array([
      scaleX, 0, 0, 0,
      0, scaleY, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ])
    this.gl.useProgram(this.program)
    this.gl.uniformMatrix4fv(
      this.uniforms.projectionMatrix,
      false,
      projectionMatrix
    )
  }

  setView (scale: number, offsetX: number, offsetY: number) {
    this.pendingView = { scale, offsetX, offsetY }
    if (!this.ensureProgramReady() || !this.uniforms || !this.program) {
      return
    }
    const viewMatrix = buildViewMatrix(scale, offsetX, offsetY)
    this.gl.useProgram(this.program)
    this.gl.uniformMatrix4fv(this.uniforms.modelViewMatrix, false, viewMatrix)
  }

  updateTexture (data: Float32Array | Uint8Array) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    const textureType = this.useFloatTexture ? gl.FLOAT : gl.UNSIGNED_BYTE
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      BOARD_SIZE,
      BOARD_SIZE,
      gl.RGBA,
      textureType,
      data
    )
  }

  render (state: RenderState) {
    if (!this.ensureProgramReady() || !this.uniforms || !this.program) {
      return
    }
    const gl = this.gl
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)

    gl.uniform1f(this.uniforms.time, state.time)
    gl.uniform1f(this.uniforms.player, state.player)
    gl.uniform1i(this.uniforms.depth, state.depth)
    gl.uniform1f(this.uniforms.constraintLevel, state.constraintLevel)
    gl.uniform1f(this.uniforms.gameOver, state.gameOver)
    gl.uniform2i(this.uniforms.hover, state.hover.x, state.hover.y)
    gl.uniform4f(
      this.uniforms.constraint,
      state.constraint.x,
      state.constraint.y,
      state.constraint.w,
      state.constraint.h
    )

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
  }

  dispose () {
    const gl = this.gl
    if (this.pendingProgram) {
      gl.deleteProgram(this.pendingProgram.program)
      gl.deleteShader(this.pendingProgram.vertex)
      gl.deleteShader(this.pendingProgram.fragment)
      this.pendingProgram = null
    }
    gl.deleteTexture(this.texture)
    gl.deleteBuffer(this.buffer)
    if (this.program) {
      gl.deleteProgram(this.program)
      this.program = null
    }
  }
}

let rendererInstance: GameRenderer | null = null
let compileRequested = false
let rendererInitError: Error | null = null
let rendererInitStatus: RendererInitStatus = {
  ok: false,
  reason: 'Renderer has not been initialized yet.',
}
let initFailureLogged = false
let compatProfileLogged = false

const scheduleAfterLoadIdle = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {}

  let cleanup: (() => void) | null = null

  const runIdle = () => {
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(callback, { timeout: 2000 })
      cleanup = () => {
        if ('cancelIdleCallback' in window) {
          cancelIdleCallback(idleId)
        }
      }
    } else {
      const timeoutId = window.setTimeout(callback, 200)
      cleanup = () => clearTimeout(timeoutId)
    }
  }

  if (document.readyState === 'complete') {
    runIdle()
    return () => cleanup?.()
  }

  const handleLoad = () => {
    runIdle()
  }
  window.addEventListener('load', handleLoad, { once: true })

  return () => {
    window.removeEventListener('load', handleLoad)
    cleanup?.()
  }
}

export const getRenderer = () => {
  if (rendererInstance) return rendererInstance
  if (rendererInitError) {
    throw rendererInitError
  }

  const canvas = document.createElement('canvas')
  try {
    rendererInstance = new GameRenderer(canvas)
    rendererInitStatus = { ok: true, profile: rendererInstance.profile }
    rendererInitError = null

    if (
      import.meta.env.DEV &&
      rendererInstance.profile !== 'strict' &&
      !compatProfileLogged
    ) {
      compatProfileLogged = true
      console.info(
        `[Renderer] WebGL2 compatibility profile selected: ${rendererInstance.profile}`
      )
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    rendererInitError = err
    rendererInitStatus = { ok: false, reason: getInitReason(error) }

    if (import.meta.env.DEV && !initFailureLogged) {
      initFailureLogged = true
      const details = error instanceof RendererInitError
        ? {
            attemptedProfiles: error.attemptedProfiles,
            webgl2ApiAvailable: error.webgl2ApiAvailable,
          }
        : null
      console.warn('[Renderer] WebGL2 initialization failed.', {
        reason: rendererInitStatus.reason,
        details,
        error: err,
      })
    }

    throw err
  }

  return rendererInstance
}

export const requestRendererCompile = () => {
  if (compileRequested) return
  compileRequested = true

  scheduleAfterLoadIdle(() => {
    try {
      const renderer = getRenderer()
      renderer.startProgramCompile()
    } catch (error) {
      compileRequested = false
      if (import.meta.env.DEV) {
        console.warn(
          '[Renderer] Skipping async shader precompile because renderer init failed.',
          error
        )
      }
    }
  })
}

export const getRendererInitStatus = (): RendererInitStatus => rendererInitStatus

export const disposeRenderer = () => {
  if (rendererInstance) {
    rendererInstance.dispose()
    rendererInstance = null
  }
  compileRequested = false
  rendererInitError = null
  rendererInitStatus = {
    ok: false,
    reason: 'Renderer has not been initialized yet.',
  }
  initFailureLogged = false
  compatProfileLogged = false
}
