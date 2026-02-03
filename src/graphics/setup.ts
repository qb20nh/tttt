import {
  OrthographicCamera,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector4,
  PlaneGeometry,
  Scene,
  Mesh,
} from 'three'
import { vertexShader, fragmentShader } from './shaders'
import { BOARD_SIZE } from '../game/constants'

export const createGameScene = () => {
  const scene = new Scene()
  return scene
}

export const createGameCamera = () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.position.z = 1
  return camera
}

export const createGameTexture = () => {
  const size = BOARD_SIZE * BOARD_SIZE
  const data = new Float32Array(size * 4)
  const texture = new DataTexture(
    data,
    BOARD_SIZE,
    BOARD_SIZE,
    RGBAFormat,
    FloatType
  )
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

export const createGameMaterial = (
  texture: DataTexture,
  initialDepth: number = 4,
  initialPlayer: number = 0,
  initialConstraint: { x: number; y: number; w: number; h: number } = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  }
) => {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uStateTexture: { value: texture },
      uHover: { value: [-1, -1] },
      uConstraint: {
        value: new Vector4(
          initialConstraint.x,
          initialConstraint.y,
          initialConstraint.w,
          initialConstraint.h
        ),
      },
      uPlayer: { value: initialPlayer },
      uTime: { value: 0 },
      uDepth: { value: initialDepth },
      uConstraintLevel: { value: 0 },
      uGameOver: { value: 0 },
    },
  })
}

export const createGameGeometry = () => {
  return new PlaneGeometry(2, 2)
}

export const createGameMesh = (material: ShaderMaterial) => {
  const geometry = createGameGeometry()
  const mesh = new Mesh(geometry, material)
  return { mesh, geometry }
}
