import { ChangeEvent, useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import {
  CUSTOM_BACKGROUND_PALETTE,
  proceduralBackgroundCompositeFragmentShader,
  proceduralBackgroundFragmentShader,
  proceduralBackgroundVertexShader,
  type ProceduralBackgroundPalette,
} from "./proceduralBackground";

type WindControls = {
  strength: number;
  turbulence: number;
  direction: number;
  speed: number;
  gravity: number;
  gustiness: number;
};

type MaterialControls = {
  preset: number;
  scale: number;
  thickness: number;
  normalStrength: number;
  bumpStrength: number;
  roughness: number;
};

type GrabControls = {
  resistance: number;
  radius: number;
  activationDistance: number;
  inertia: number;
};

type LightingControls = {
  ambient: number;
  keyIntensity: number;
  horizontal: number;
  vertical: number;
  depth: number;
  rimIntensity: number;
  color: string;
  premiereIntensity: number;
  premiereSpeed: number;
};

type WindSoundControls = {
  volume: number;
  body: number;
  air: number;
  gustDepth: number;
  clothVolume: number;
  clothRustle: number;
  clothImpact: number;
  clothWeight: number;
};

type ClothAudioMetrics = {
  motion: number;
  impact: number;
};

type ClothStepMetrics = ClothAudioMetrics & {
  releasedGrab: boolean;
};

type TransitionOrigin = {
  x: number;
  y: number;
  screenX?: number;
  screenY?: number;
};

type ClothGrabController = {
  begin: (
    u: number,
    v: number,
    x: number,
    y: number,
    z: number,
  ) => boolean;
  move: (x: number, y: number, z: number) => void;
  end: () => void;
  configure: (settings: GrabControls) => void;
};

type DesignTransition = (
  image: HTMLImageElement,
  color: string,
  artworkScale: number,
  direction: number,
  origin: TransitionOrigin,
) => void;

type WindAudioEngine = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  bodyFilter: BiquadFilterNode;
  detailFilter: BiquadFilterNode;
  gustFilter: BiquadFilterNode;
  clothFilter: BiquadFilterNode;
  bodyGain: GainNode;
  detailGain: GainNode;
  gustGain: GainNode;
  clothGain: GainNode;
  masterGain: GainNode;
  panner: StereoPannerNode;
  impactBuffer: AudioBuffer;
  lastImpactAt: number;
  nextImpactAt: number;
  updateTimer: number;
  startedAt: number;
};

type DesignPreset = {
  id: string;
  label: string;
  color: string;
  asset: string;
  identityBackground: string;
  background: ProceduralBackgroundPalette;
};

type BackgroundControls = Pick<
  ProceduralBackgroundPalette,
  "intensity" | "speed" | "warp"
>;

type ControlTab =
  | "motion"
  | "sound"
  | "grab"
  | "material"
  | "lighting"
  | "background"
  | "artwork";
type MeshQuality = 1 | 2 | 3 | 4;
type TransitionMode = "logo" | "touch" | "weave" | "tear";
type ClothAnchor = "left" | "top";

type ClothLayout = {
  width: number;
  height: number;
  textureWidth: number;
  textureHeight: number;
  anchor: ClothAnchor;
};

const INITIAL_WIND: WindControls = {
  strength: 3.77,
  turbulence: 8,
  direction: 1,
  speed: 1.2,
  gravity: 1.34,
  gustiness: 3,
};

const INITIAL_FLAG_SIZE = 1.2;
const INITIAL_ARTWORK_SCALE = 0.55;
const INITIAL_MESH_QUALITY: MeshQuality = 2;
const INITIAL_TRANSITION_MODE: TransitionMode = "logo";
const MAX_ARTWORK_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ARTWORK_DIMENSION = 8192;
const ALLOWED_ARTWORK_TYPES = new Set(["image/png", "image/webp"]);
const DEFAULT_TRANSITION_ORIGIN: TransitionOrigin = {
  x: 0.5,
  y: 0.5,
  screenX: 0.5,
  screenY: 0.5,
};

const MESH_RESOLUTIONS: Record<
  MeshQuality,
  { columns: number; rows: number }
> = {
  1: { columns: 48, rows: 28 },
  2: { columns: 72, rows: 42 },
  3: { columns: 96, rows: 56 },
  4: { columns: 112, rows: 64 },
};

const LANDSCAPE_CLOTH: ClothLayout = {
  width: 3.35,
  height: 1.9,
  textureWidth: 1024,
  textureHeight: 576,
  anchor: "left",
};

const PORTRAIT_CLOTH: ClothLayout = {
  width: LANDSCAPE_CLOTH.height,
  height: LANDSCAPE_CLOTH.width,
  textureWidth: LANDSCAPE_CLOTH.textureHeight,
  textureHeight: LANDSCAPE_CLOTH.textureWidth,
  anchor: "top",
};

const MOBILE_PORTRAIT_QUERY =
  "(max-width: 780px) and (orientation: portrait)";

const INITIAL_MATERIAL: MaterialControls = {
  preset: 0,
  scale: 2.5,
  thickness: 0.009,
  normalStrength: 0.58,
  bumpStrength: 0.69,
  roughness: 1,
};

const INITIAL_GRAB: GrabControls = {
  resistance: 1,
  radius: 0.24,
  activationDistance: 30,
  inertia: 0.2,
};

const INITIAL_WIND_SOUND: WindSoundControls = {
  volume: 0.55,
  body: 0.8,
  air: 0.62,
  gustDepth: 0.82,
  clothVolume: 0.78,
  clothRustle: 0.06,
  clothImpact: 1.35,
  clothWeight: 0.88,
};

const INITIAL_LIGHTING: LightingControls = {
  ambient: 0.25,
  keyIntensity: 1,
  horizontal: -0.45,
  vertical: 0.72,
  depth: 1,
  rimIntensity: 0.18,
  color: "#FFF2D8",
  premiereIntensity: 1.15,
  premiereSpeed: 1,
};

const getBackgroundControls = (
  palette: ProceduralBackgroundPalette,
): BackgroundControls => ({
  intensity: palette.intensity,
  speed: palette.speed,
  warp: palette.warp,
});

const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "brubank",
    label: "Brubank",
    color: "#614AD9",
    asset: "/flags/brubank.png",
    identityBackground: "#100B21",
    background: {
      edge: "#100B21",
      colors: ["#2B1765", "#614AD9", "#A18BFF"],
      seed: 2.15,
      speed: 0.42,
      warp: 0.2,
      intensity: 0.08,
    },
  },
  {
    id: "xapo",
    label: "Xapo",
    color: "#FFFFFF",
    asset: "/flags/xapo.png",
    identityBackground: "#17130F",
    background: {
      edge: "#17130F",
      colors: ["#3B2618", "#E95820", "#E8D7BC"],
      seed: 4.7,
      speed: 0.3,
      warp: 0.14,
      intensity: 0.06,
    },
  },
  {
    id: "popcorn",
    label: "Popcorn",
    color: "#EF0000",
    asset: "/flags/popcorn.png",
    identityBackground: "#170607",
    background: {
      edge: "#170607",
      colors: ["#52090B", "#EF0000", "#FFB05C"],
      seed: 6.35,
      speed: 0.58,
      warp: 0.23,
      intensity: 0.07,
    },
  },
  {
    id: "ba",
    label: "BA",
    color: "#FED501",
    asset: "/flags/ba.png",
    identityBackground: "#171404",
    background: {
      edge: "#171404",
      colors: ["#453A04", "#CDAE00", "#FFF1A3"],
      seed: 9.2,
      speed: 0.27,
      warp: 0.12,
      intensity: 0.06,
    },
  },
  {
    id: "taringa",
    label: "Taringa",
    color: "#005DAB",
    asset: "/flags/taringa.png",
    identityBackground: "#05111D",
    background: {
      edge: "#05111D",
      colors: ["#073B64", "#005DAB", "#2495FF"],
      seed: 12.8,
      speed: 0.38,
      warp: 0.19,
      intensity: 0.07,
    },
  },
];

const INITIAL_DESIGN = DESIGN_PRESETS[0];
const FLAG_COLORS = DESIGN_PRESETS.map((design) => design.color);

const FABRIC_PRESETS = [
  { id: 0, label: "Algodón", detail: "Trama plana" },
  { id: 1, label: "Lino", detail: "Fibra irregular" },
  { id: 2, label: "Sarga", detail: "Tejido diagonal" },
  { id: 3, label: "Ripstop", detail: "Malla técnica" },
  { id: 4, label: "Liso", detail: "Sin microtrama" },
];

const TRANSITION_OPTIONS: {
  id: TransitionMode;
  label: string;
  detail: string;
}[] = [
  {
    id: "logo",
    label: "Logo",
    detail: "El símbolo se expande desde el punto de contacto",
  },
  {
    id: "touch",
    label: "Toque",
    detail: "Onda circular desde el punto de contacto",
  },
  {
    id: "weave",
    label: "Trama",
    detail: "Barrido compacto entre fibras",
  },
  {
    id: "tear",
    label: "Rasgado",
    detail: "Aberturas orgánicas y bordes rotos",
  },
];

function getTransitionModeValue(mode: TransitionMode) {
  if (mode === "tear") return 1;
  if (mode === "touch") return 2;
  if (mode === "logo") return 3;
  return 0;
}

const vertexShader = /* glsl */ `
  uniform float uFlagSize;
  uniform float uThickness;
  uniform float uTransitionScale;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vFold;

  void main() {
    vUv = uv;
    vec3 p =
      (position + normal * uThickness * 0.5 * SURFACE_DIRECTION) *
      uFlagSize *
      uTransitionScale;
    vWorldNormal = normalize(normalMatrix * normal);
    vFold = position.z;
    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uPreviousColor;
  uniform sampler2D uArtwork;
  uniform sampler2D uPreviousArtwork;
  uniform float uDesignTransition;
  uniform float uTransitionDirection;
  uniform float uTransitionMode;
  uniform float uTransitionSeed;
  uniform vec2 uTransitionOrigin;
  uniform vec2 uTransitionScreenOrigin;
  uniform vec2 uViewport;
  uniform float uFabricPreset;
  uniform float uTextureScale;
  uniform float uNormalStrength;
  uniform float uBumpStrength;
  uniform float uRoughness;
  uniform float uAmbientIntensity;
  uniform float uKeyIntensity;
  uniform float uLightX;
  uniform float uLightY;
  uniform float uLightZ;
  uniform float uRimIntensity;
  uniform vec3 uLightColor;
  uniform float uPremiereActive;
  uniform float uPremiereIntensity;
  uniform float uPremiereSpeed;
  uniform vec2 uClothSize;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vFold;

  float thread(float value, float frequency, float sharpness) {
    float phase = value * frequency;
    float ridge = pow(0.5 + 0.5 * cos(phase), sharpness);
    float footprint = fwidth(phase);
    float visibility = 1.0 - smoothstep(0.55, 2.35, footprint);
    return mix(0.34, ridge, visibility);
  }

  float transitionHash(vec2 p) {
    return fract(
      sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123
    );
  }

  float transitionNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    vec2 blend = local * local * (3.0 - 2.0 * local);
    float a = transitionHash(cell);
    float b = transitionHash(cell + vec2(1.0, 0.0));
    float c = transitionHash(cell + vec2(0.0, 1.0));
    float d = transitionHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  }

  float transitionFbm(vec2 p) {
    float value = 0.0;
    value += transitionNoise(p) * 0.52;
    p = p * 2.03 + vec2(13.7, 7.9);
    value += transitionNoise(p) * 0.27;
    p = p * 2.07 + vec2(5.4, 17.3);
    value += transitionNoise(p) * 0.14;
    p = p * 2.11 + vec2(19.1, 3.6);
    value += transitionNoise(p) * 0.07;
    return value;
  }

  float sdCapsule(
    vec2 point,
    vec2 start,
    vec2 end,
    float radius
  ) {
    vec2 segment = end - start;
    float projection = clamp(
      dot(point - start, segment) /
      max(dot(segment, segment), 0.00001),
      0.0,
      1.0
    );
    return length(point - start - segment * projection) - radius;
  }

  float logoSdf(vec2 point) {
    const float armRadius = 0.13;
    const float cardinalReach = 0.365;
    const float diagonalReach = 0.258;
    float distanceToLogo = sdCapsule(
      point,
      vec2(-cardinalReach, 0.0),
      vec2(cardinalReach, 0.0),
      armRadius
    );
    distanceToLogo = min(
      distanceToLogo,
      sdCapsule(
        point,
        vec2(0.0, -cardinalReach),
        vec2(0.0, cardinalReach),
        armRadius
      )
    );
    distanceToLogo = min(
      distanceToLogo,
      sdCapsule(
        point,
        vec2(-diagonalReach, -diagonalReach),
        vec2(diagonalReach, diagonalReach),
        armRadius
      )
    );
    distanceToLogo = min(
      distanceToLogo,
      sdCapsule(
        point,
        vec2(-diagonalReach, diagonalReach),
        vec2(diagonalReach, -diagonalReach),
        armRadius
      )
    );
    return distanceToLogo;
  }

  float weaveHeight(vec2 uv) {
    vec2 physicalTextureScale =
      uClothSize / vec2(3.35, 1.9);
    vec2 p =
      uv *
      max(uTextureScale, 0.2) *
      physicalTextureScale;

    if (uFabricPreset > 3.5) {
      return 0.5;
    }

    if (uFabricPreset < 0.5) {
      float warp = thread(p.x, 420.0, 4.5);
      float weft = thread(p.y, 310.0, 4.5);
      float overUnder =
        0.5 + 0.5 * sin(p.x * 210.0) * sin(p.y * 155.0);
      float selectorFootprint = max(
        fwidth(p.x * 210.0),
        fwidth(p.y * 155.0)
      );
      overUnder = mix(
        0.5,
        overUnder,
        1.0 - smoothstep(0.65, 2.2, selectorFootprint)
      );
      return mix(warp, weft, smoothstep(0.38, 0.62, overUnder));
    }

    if (uFabricPreset < 1.5) {
      float warp = thread(p.x + sin(p.y * 31.0) * 0.0022, 320.0, 6.0);
      float weft = thread(p.y + sin(p.x * 37.0) * 0.0028, 235.0, 5.5);
      float irregular =
        0.5 + 0.5 * sin(p.x * 83.0 + sin(p.y * 71.0) * 1.4);
      return clamp(warp * 0.55 + weft * 0.38 + irregular * 0.07, 0.0, 1.0);
    }

    if (uFabricPreset < 2.5) {
      float diagonal = thread(p.x * 0.78 + p.y, 260.0, 4.0);
      float counter = thread(p.x - p.y * 0.24, 460.0, 6.0);
      return diagonal * 0.76 + counter * 0.24;
    }

    float fine =
      thread(p.x, 360.0, 5.0) * 0.24 +
      thread(p.y, 320.0, 5.0) * 0.22;
    float grid = max(
      thread(p.x, 70.0, 14.0),
      thread(p.y, 62.0, 14.0)
    );
    return clamp(fine + grid * 0.66, 0.0, 1.0);
  }

  float premiereBeam(vec2 uv, float originX, float phase) {
    float sweep =
      sin(uTime * uPremiereSpeed * 0.62 + phase) * 0.48 +
      sin(uTime * uPremiereSpeed * 0.27 + phase * 1.7) * 0.17;
    vec2 direction = normalize(vec2(sin(sweep), cos(sweep)));
    vec2 relative = uv - vec2(originX, -0.16);
    float along = dot(relative, direction);
    float across = abs(dot(relative, vec2(direction.y, -direction.x)));
    float width = 0.018 + max(along, 0.0) * 0.075;
    float cone = exp(-pow(across / max(width, 0.008), 2.0) * 2.3);
    float reach =
      smoothstep(-0.02, 0.13, along) *
      (1.0 - smoothstep(0.95, 1.42, along));
    return cone * reach;
  }

  void main() {
    vec3 dpdx = dFdx(vWorldPosition);
    vec3 dpdy = dFdy(vWorldPosition);
    vec2 duvdx = dFdx(vUv);
    vec2 duvdy = dFdy(vUv);
    vec3 macroNormal = normalize(vWorldNormal);
    if (!gl_FrontFacing) macroNormal *= -1.0;

    float determinant = duvdx.x * duvdy.y - duvdx.y * duvdy.x;
    float inverseDeterminant =
      abs(determinant) > 0.000001 ? 1.0 / determinant : 1.0;
    vec3 tangent = normalize(
      (dpdx * duvdy.y - dpdy * duvdx.y) * inverseDeterminant
    );
    vec3 bitangent = normalize(
      (-dpdx * duvdy.x + dpdy * duvdx.x) * inverseDeterminant
    );

    vec2 physicalTextureScale =
      uClothSize / vec2(3.35, 1.9);
    float textureFootprint =
      max(
        fwidth(vUv.x) * physicalTextureScale.x,
        fwidth(vUv.y) * physicalTextureScale.y
      ) *
      max(uTextureScale, 0.2);
    float detailFade =
      1.0 - smoothstep(0.0024, 0.0085, textureFootprint);
    vec2 texel =
      vec2(0.0016) /
      max(uTextureScale, 0.2) /
      max(physicalTextureScale, vec2(0.001));
    float height = weaveHeight(vUv);
    float dHeightX =
      weaveHeight(vUv + vec2(texel.x, 0.0)) - height;
    float dHeightY =
      weaveHeight(vUv + vec2(0.0, texel.y)) - height;
    vec3 normal = normalize(
      macroNormal -
      tangent * dHeightX * uNormalStrength * detailFade * 0.58 -
      bitangent * dHeightY * uNormalStrength * detailFade * 0.58
    );

    vec3 keyLight = normalize(vec3(uLightX, uLightY, uLightZ));
    vec3 rimLight = normalize(vec3(0.7, -0.2, -0.55));
    float diffuse = max(dot(normal, keyLight), 0.0);
    float rim = pow(1.0 - abs(normal.z), 2.4);
    float back = max(dot(normal, rimLight), 0.0);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 halfDirection = normalize(keyLight + viewDirection);
    float specularPower = mix(96.0, 9.0, uRoughness);
    float specular =
      pow(max(dot(normal, halfDirection), 0.0), specularPower) *
      mix(0.34, 0.035, uRoughness);

    float reveal = 1.0;
    float tearEdge = 0.0;
    float radialEdge = 0.0;

    if (uDesignTransition < 0.999) {
      float progress = clamp(uDesignTransition, 0.0, 1.0);
      float transitionCoordinate =
        uTransitionDirection > 0.0 ? vUv.x : 1.0 - vUv.x;

      if (uTransitionMode < 0.5) {
        float transitionFront = mix(-0.18, 1.18, progress);
        float transitionGrain =
          (height - 0.5) * 0.07 +
          sin(vUv.y * 93.0 + vUv.x * 31.0) * 0.008 +
          sin(vUv.y * 211.0 - vUv.x * 47.0) * 0.004;
        reveal = 1.0 - smoothstep(
          transitionFront - 0.032,
          transitionFront + 0.032,
          transitionCoordinate + transitionGrain
        );
      } else if (uTransitionMode < 1.5) {
        float clothAspect =
          uClothSize.x / max(uClothSize.y, 0.001);
        vec2 tearUv = vec2(
          vUv.x * clothAspect * 4.084,
          vUv.y * 2.35
        );
        tearUv.x += sin(vUv.y * 15.0 + uTransitionSeed) * 0.34;
        tearUv += vec2(uTransitionSeed * 1.37, uTransitionSeed * 0.73);
        float tearField =
          transitionFbm(tearUv) * 0.78 +
          transitionNoise(tearUv * vec2(2.6, 2.1) + 8.4) * 0.22;
        float localTearProgress = clamp(
          progress * 1.32 - transitionCoordinate * 0.32,
          0.0,
          1.0
        );
        float tearThreshold = mix(1.08, -0.08, localTearProgress);
        reveal = smoothstep(
          tearThreshold - 0.028,
          tearThreshold + 0.028,
          tearField
        );
        tearEdge =
          1.0 -
          smoothstep(0.0, 0.055, abs(tearField - tearThreshold));
      } else if (uTransitionMode < 2.5) {
        vec2 radialVector = vec2(
          (vUv.x - uTransitionOrigin.x) *
            uClothSize.x /
            max(uClothSize.y, 0.001),
          vUv.y - uTransitionOrigin.y
        );
        float radialDistance = length(radialVector);
        vec2 farthestCorner = max(
          uTransitionOrigin,
          vec2(1.0) - uTransitionOrigin
        );
        float radialMaxDistance = length(
          vec2(
            farthestCorner.x *
              uClothSize.x /
              max(uClothSize.y, 0.001),
            farthestCorner.y
          )
        );
        float radialRadius = mix(
          -0.08,
          radialMaxDistance + 0.08,
          progress
        );
        float radialGrain =
          (height - 0.5) * 0.035 +
          sin(vUv.x * 157.0 + vUv.y * 83.0) * 0.006;
        reveal = 1.0 - smoothstep(
          radialRadius - 0.034,
          radialRadius + 0.034,
          radialDistance + radialGrain
        );
        radialEdge =
          1.0 -
          smoothstep(
            0.0,
            0.045,
            abs(radialDistance + radialGrain - radialRadius)
          );
      } else {
        vec2 safeViewport = max(uViewport, vec2(1.0));
        vec2 screenPosition = gl_FragCoord.xy / safeViewport;
        float screenAspect = safeViewport.x / safeViewport.y;
        vec2 screenVector =
          (screenPosition - uTransitionScreenOrigin) *
          vec2(screenAspect, 1.0);
        vec2 farthestScreenCorner = max(
          uTransitionScreenOrigin,
          vec2(1.0) - uTransitionScreenOrigin
        ) * vec2(screenAspect, 1.0);
        float screenMaxDistance = length(farthestScreenCorner);
        float logoGrowth = progress * progress;
        float logoScale = mix(
          0.16,
          screenMaxDistance * 5.8,
          logoGrowth
        );
        float logoDistance = logoSdf(
          screenVector / max(logoScale, 0.001)
        );
        float logoAntialias =
          max(fwidth(logoDistance) * 1.35, 0.0008);
        reveal = 1.0 - smoothstep(
          -logoAntialias,
          logoAntialias,
          logoDistance
        );
        reveal = max(reveal, smoothstep(0.97, 1.0, progress));
      }
    }
    vec4 previousArtwork = texture2D(uPreviousArtwork, vUv);
    vec4 nextArtwork = texture2D(uArtwork, vUv);
    vec3 previousFabric = mix(
      uPreviousColor,
      previousArtwork.rgb,
      previousArtwork.a
    );
    vec3 nextFabric = mix(uColor, nextArtwork.rgb, nextArtwork.a);
    vec3 fabric =
      mix(previousFabric, nextFabric, reveal) * SURFACE_SHADE;
    fabric *= 1.0 - tearEdge * 0.2 - radialEdge * 0.08;
    float bump = (height - 0.5) * uBumpStrength * detailFade;
    fabric *= 1.0 + bump * 0.08;

    float directLighting =
      diffuse * 0.76 * uKeyIntensity +
      back * 0.16 +
      rim * uRimIntensity;
    directLighting += bump * 0.035;
    directLighting += clamp(vFold, -0.6, 0.6) * 0.09;
    vec3 lighting =
      vec3(max(uAmbientIntensity, 0.0)) +
      uLightColor * max(directLighting, 0.0);
    float premiereLighting = 0.0;
    if (uPremiereActive > 0.5) {
      premiereLighting =
        (
          premiereBeam(vUv, 0.12, 0.2) +
          premiereBeam(vUv, 0.48, 2.4) +
          premiereBeam(vUv, 0.86, 4.5)
        ) *
        uPremiereIntensity;
    }
    vec3 premiereColor = vec3(0.52, 0.68, 1.0);
    lighting += premiereColor * premiereLighting * 0.92;

    gl_FragColor = vec4(
      fabric * lighting +
      specular * uLightColor * uKeyIntensity +
      premiereColor * premiereLighting * 0.055,
      1.0
    );
  }
`;

const edgeVertexShader = /* glsl */ `
  uniform float uFlagSize;
  uniform float uThickness;
  uniform float uTransitionScale;

  attribute vec3 aClothNormal;
  attribute float aSide;

  varying vec3 vWorldPosition;

  void main() {
    vec3 p =
      (position + aClothNormal * uThickness * 0.5 * aSide) *
      uFlagSize *
      uTransitionScale;
    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const edgeFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmbientIntensity;
  uniform float uKeyIntensity;
  uniform float uLightX;
  uniform float uLightY;
  uniform float uLightZ;
  uniform vec3 uLightColor;

  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(
      cross(dFdx(vWorldPosition), dFdy(vWorldPosition))
    );
    if (!gl_FrontFacing) normal *= -1.0;

    vec3 keyLight = normalize(vec3(uLightX, uLightY, uLightZ));
    float diffuse = max(dot(normal, keyLight), 0.0);
    vec3 edgeLighting =
      vec3(max(uAmbientIntensity * 0.8, 0.0)) +
      uLightColor * diffuse * 0.34 * uKeyIntensity;
    vec3 edgeColor = uColor * edgeLighting;
    gl_FragColor = vec4(edgeColor, 1.0);
  }
`;

function createEmptyArtwork(layout: ClothLayout) {
  const artwork = document.createElement("canvas");
  artwork.width = layout.textureWidth;
  artwork.height = layout.textureHeight;
  return artwork;
}

type ArtworkBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const artworkBoundsCache = new WeakMap<HTMLImageElement, ArtworkBounds>();
const designImageCache = new Map<string, HTMLImageElement>();

function getArtworkBounds(image: HTMLImageElement): ArtworkBounds {
  const cachedBounds = artworkBoundsCache.get(image);
  if (cachedBounds) return cachedBounds;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext) {
    return {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }

  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  ).data;
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const alpha = pixels[(y * sourceCanvas.width + x) * 4 + 3];
      if (alpha < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const bounds =
    maxX < minX || maxY < minY
      ? {
          x: 0,
          y: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
      : {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        };
  artworkBoundsCache.set(image, bounds);
  return bounds;
}

function drawArtworkImage(
  artworkCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  artworkScale: number,
) {
  const targetContext = artworkCanvas.getContext("2d");
  if (!targetContext) return;
  const bounds = getArtworkBounds(image);
  targetContext.clearRect(0, 0, artworkCanvas.width, artworkCanvas.height);
  const sourceWidth = bounds.width;
  const sourceHeight = bounds.height;
  const horizontalPadding = 96;
  const verticalPadding = 72;
  const fitScale = Math.min(
    (artworkCanvas.width - horizontalPadding * 2) / sourceWidth,
    (artworkCanvas.height - verticalPadding * 2) / sourceHeight,
  );
  const scale = fitScale * artworkScale;
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;

  targetContext.drawImage(
    image,
    bounds.x,
    bounds.y,
    sourceWidth,
    sourceHeight,
    (artworkCanvas.width - targetWidth) / 2,
    (artworkCanvas.height - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
}

function distanceToSegment(
  x: number,
  y: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared =
    segmentX * segmentX + segmentY * segmentY;
  const projection = THREE.MathUtils.clamp(
    ((x - startX) * segmentX + (y - startY) * segmentY) /
      segmentLengthSquared,
    0,
    1,
  );
  return Math.hypot(
    x - (startX + segmentX * projection),
    y - (startY + segmentY * projection),
  );
}

function tearNoise(
  u: number,
  v: number,
  columns: number,
  rows: number,
) {
  const gridX = Math.floor(u * columns);
  const gridY = Math.floor(v * rows);
  return (
    Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453 -
    Math.floor(
      Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453,
    )
  );
}

function isLandscapeTornArea(
  u: number,
  v: number,
  expansion: number,
  columns: number,
  rows: number,
) {
  const noise = tearNoise(u, v, columns, rows) - 0.5;
  const largeHole =
    ((u - 0.72) / (0.075 + expansion + noise * 0.012)) ** 2 +
      ((v - 0.67) / (0.105 + expansion + noise * 0.015)) ** 2 <
    1;
  const smallHole =
    ((u - 0.36) / (0.045 + expansion + noise * 0.01)) ** 2 +
      ((v - 0.3) / (0.066 + expansion + noise * 0.012)) ** 2 <
    1;
  const mainSlit =
    distanceToSegment(u, v, 0.43, 0.73, 0.58, 0.38) <
    0.014 + expansion + Math.abs(noise) * 0.008;
  const splitSlit =
    distanceToSegment(u, v, 0.52, 0.52, 0.64, 0.43) <
    0.009 + expansion + Math.abs(noise) * 0.006;
  const edgeDistance = Math.abs(v - 0.2);
  const edgeTear =
    edgeDistance < 0.14 + expansion &&
    u >
      0.885 +
        edgeDistance * 0.5 -
        expansion * 1.5 +
        noise * 0.018;

  return largeHole || smallHole || mainSlit || splitSlit || edgeTear;
}

function isTornArea(
  u: number,
  v: number,
  expansion: number,
  columns: number,
  rows: number,
  anchor: ClothAnchor,
) {
  if (anchor === "top") {
    return isLandscapeTornArea(
      1 - v,
      u,
      expansion,
      rows,
      columns,
    );
  }

  return isLandscapeTornArea(
    u,
    v,
    expansion,
    columns,
    rows,
  );
}

function createTornIndex(
  geometry: THREE.PlaneGeometry,
  columns: number,
  rows: number,
  anchor: ClothAnchor,
) {
  const sourceIndex = geometry.getIndex();
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  if (!sourceIndex) return null;
  const keptIndices: number[] = [];

  for (let triangle = 0; triangle < sourceIndex.count; triangle += 3) {
    const a = sourceIndex.getX(triangle);
    const b = sourceIndex.getX(triangle + 1);
    const c = sourceIndex.getX(triangle + 2);
    const centerU = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const centerV = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    if (!isTornArea(centerU, centerV, 0, columns, rows, anchor)) {
      keptIndices.push(a, b, c);
    }
  }

  return new THREE.BufferAttribute(new Uint16Array(keptIndices), 1);
}

function createClothEdgeGeometry(
  sourceGeometry: THREE.PlaneGeometry,
  topology: THREE.BufferAttribute,
) {
  const edgeUsage = new Map<
    string,
    { start: number; end: number; count: number }
  >();

  for (let triangle = 0; triangle < topology.count; triangle += 3) {
    const vertices = [
      topology.getX(triangle),
      topology.getX(triangle + 1),
      topology.getX(triangle + 2),
    ];
    for (let edge = 0; edge < 3; edge += 1) {
      const start = vertices[edge];
      const end = vertices[(edge + 1) % 3];
      const key =
        start < end ? `${start}:${end}` : `${end}:${start}`;
      const existing = edgeUsage.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeUsage.set(key, { start, end, count: 1 });
      }
    }
  }

  const boundaryEdges = [...edgeUsage.values()].filter(
    (edge) => edge.count === 1,
  );
  const sourceVertices: number[] = [];
  const edgeGeometry = new THREE.BufferGeometry();
  const edgePositions = new Float32Array(boundaryEdges.length * 4 * 3);
  const edgeNormals = new Float32Array(boundaryEdges.length * 4 * 3);
  const edgeSides = new Float32Array(boundaryEdges.length * 4);
  const indices: number[] = [];

  for (let edge = 0; edge < boundaryEdges.length; edge += 1) {
    const boundary = boundaryEdges[edge];
    const front = edge * 4;
    const back = front + 1;
    const nextFront = front + 2;
    const nextBack = nextFront + 1;
    indices.push(front, back, nextFront, back, nextBack, nextFront);
    sourceVertices.push(
      boundary.start,
      boundary.start,
      boundary.end,
      boundary.end,
    );
    edgeSides[front] = 1;
    edgeSides[back] = -1;
    edgeSides[nextFront] = 1;
    edgeSides[nextBack] = -1;
  }

  const positionAttribute = new THREE.BufferAttribute(edgePositions, 3);
  const normalAttribute = new THREE.BufferAttribute(edgeNormals, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  normalAttribute.setUsage(THREE.DynamicDrawUsage);
  edgeGeometry.setAttribute("position", positionAttribute);
  edgeGeometry.setAttribute("aClothNormal", normalAttribute);
  edgeGeometry.setAttribute("aSide", new THREE.BufferAttribute(edgeSides, 1));
  edgeGeometry.setIndex(indices);

  const update = () => {
    const sourcePositions = sourceGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const sourceNormals = sourceGeometry.getAttribute(
      "normal",
    ) as THREE.BufferAttribute;

    for (let vertex = 0; vertex < sourceVertices.length; vertex += 1) {
      const sourceVertex = sourceVertices[vertex];
      const sourceOffset = sourceVertex * 3;
      const targetOffset = vertex * 3;
      edgePositions[targetOffset] = sourcePositions.array[sourceOffset] as number;
      edgePositions[targetOffset + 1] = sourcePositions.array[
        sourceOffset + 1
      ] as number;
      edgePositions[targetOffset + 2] = sourcePositions.array[
        sourceOffset + 2
      ] as number;
      edgeNormals[targetOffset] = sourceNormals.array[sourceOffset] as number;
      edgeNormals[targetOffset + 1] = sourceNormals.array[
        sourceOffset + 1
      ] as number;
      edgeNormals[targetOffset + 2] = sourceNormals.array[
        sourceOffset + 2
      ] as number;
    }

    positionAttribute.needsUpdate = true;
    normalAttribute.needsUpdate = true;
  };

  update();
  return { geometry: edgeGeometry, update };
}

type ClothConstraint = {
  a: number;
  b: number;
  restLength: number;
  stiffness: number;
  maxStretch: number;
  disabledWhenTorn: boolean;
};

function createClothSimulation(
  geometry: THREE.PlaneGeometry,
  columns: number,
  rows: number,
  layout: ClothLayout,
) {
  const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = positionAttribute.array as Float32Array;
  const restPositions = new Float32Array(positions);
  const previousPositions = new Float32Array(positions);
  const uvAttribute = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const vertexCount = positions.length / 3;
  const pinned = new Uint8Array(vertexCount);
  const grabInfluence = new Float32Array(vertexCount);
  const constraints: ClothConstraint[] = [];
  const rowLength = columns + 1;
  const selfCollisionDistance = 0.06;
  const selfCollisionStiffness = 0.88;
  const autoReleaseFrames = 20;
  const spatialHash = new Map<number, number[]>();
  const spatialBuckets: number[][] = [];
  const resolutionSpan = Math.max(columns, rows);
  const baseConstraintIterations =
    resolutionSpan <= 48
      ? 5
      : resolutionSpan <= 72
        ? 6
        : resolutionSpan <= 96
          ? 7
          : 8;
  let tornEnabled = false;
  let simulationFrame = 0;
  let lastFreeEdgeVelocity = 0;
  let lastMotionEnergy = 0;
  let unsafeGrabFrames = 0;
  let autoReleaseFramesRemaining = 0;
  let grabSettings = { ...INITIAL_GRAB };
  let grabState: {
    targetX: number;
    targetY: number;
    targetZ: number;
    particles: {
      index: number;
      offsetX: number;
      offsetY: number;
      offsetZ: number;
      weight: number;
    }[];
  } | null = null;

  const index = (column: number, row: number) => row * rowLength + column;
  const hangsFromTop = layout.anchor === "top";
  const pinnedVertices = hangsFromTop
    ? [index(0, 0), index(columns, 0)]
    : [index(0, 0), index(0, rows)];

  for (const particle of pinnedVertices) {
    pinned[particle] = 1;
  }

  const addConstraint = (
    a: number,
    b: number,
    stiffness: number,
    maxStretch: number,
  ) => {
    const a3 = a * 3;
    const b3 = b * 3;
    const dx = restPositions[b3] - restPositions[a3];
    const dy = restPositions[b3 + 1] - restPositions[a3 + 1];
    const dz = restPositions[b3 + 2] - restPositions[a3 + 2];
    constraints.push({
      a,
      b,
      restLength: Math.hypot(dx, dy, dz),
      stiffness,
      maxStretch,
      disabledWhenTorn: isTornArea(
        (uvAttribute.getX(a) + uvAttribute.getX(b)) * 0.5,
        (uvAttribute.getY(a) + uvAttribute.getY(b)) * 0.5,
        0.014,
        columns,
        rows,
        layout.anchor,
      ),
    });
  };

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      if (column < columns) {
        addConstraint(index(column, row), index(column + 1, row), 0.995, 1.006);
      }
      if (row < rows) {
        addConstraint(index(column, row), index(column, row + 1), 0.995, 1.006);
      }
      if (column < columns && row < rows) {
        addConstraint(index(column, row), index(column + 1, row + 1), 0.9, 1.012);
        addConstraint(index(column + 1, row), index(column, row + 1), 0.9, 1.012);
      }
      if (column < columns - 1) {
        addConstraint(index(column, row), index(column + 2, row), 0.7, 1.025);
      }
      if (row < rows - 1) {
        addConstraint(index(column, row), index(column, row + 2), 0.7, 1.025);
      }
    }
  }

  const reset = () => {
    grabState = null;
    grabInfluence.fill(0);
    positions.set(restPositions);
    previousPositions.set(restPositions);
    lastFreeEdgeVelocity = 0;
    lastMotionEnergy = 0;
    unsafeGrabFrames = 0;
    autoReleaseFramesRemaining = 0;

    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const particle = index(column, row);
        if (pinned[particle] === 1) continue;
        const vertex = index(column, row) * 3;
        const distanceFromAnchor = hangsFromTop
          ? row / rows
          : column / columns;
        const seed = Math.sin(column * 1.73 + row * 2.31);
        positions[vertex + 2] =
          seed * 0.0025 * distanceFromAnchor;
        previousPositions[vertex + 2] = positions[vertex + 2];
      }
    }

    geometry.computeVertexNormals();
    positionAttribute.needsUpdate = true;
    geometry.getAttribute("normal").needsUpdate = true;
  };

  const solveConstraints = () => {
    for (const constraint of constraints) {
      const a3 = constraint.a * 3;
      const b3 = constraint.b * 3;
      const dx = positions[b3] - positions[a3];
      const dy = positions[b3 + 1] - positions[a3 + 1];
      const dz = positions[b3 + 2] - positions[a3 + 2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 0.000001) continue;

      const localStiffness =
        tornEnabled && constraint.disabledWhenTorn
          ? constraint.stiffness * 0.55
          : constraint.stiffness;
      const elasticDifference =
        ((distance - constraint.restLength) / distance) *
        localStiffness;
      const maximumLength = constraint.restLength * constraint.maxStretch;
      const strainLimitDifference =
        distance > maximumLength
          ? (distance - maximumLength) / distance
          : Number.NEGATIVE_INFINITY;
      const difference = Math.max(elasticDifference, strainLimitDifference);
      const aPinned = pinned[constraint.a] === 1;
      const bPinned = pinned[constraint.b] === 1;

      if (!aPinned && !bPinned) {
        const correction = difference * 0.5;
        positions[a3] += dx * correction;
        positions[a3 + 1] += dy * correction;
        positions[a3 + 2] += dz * correction;
        positions[b3] -= dx * correction;
        positions[b3 + 1] -= dy * correction;
        positions[b3 + 2] -= dz * correction;
      } else if (aPinned && !bPinned) {
        positions[b3] -= dx * difference;
        positions[b3 + 1] -= dy * difference;
        positions[b3 + 2] -= dz * difference;
      } else if (!aPinned && bPinned) {
        positions[a3] += dx * difference;
        positions[a3 + 1] += dy * difference;
        positions[a3 + 2] += dz * difference;
      }
    }
  };

  const spatialKey = (x: number, y: number, z: number) =>
    ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;

  const solveSelfCollisions = () => {
    spatialHash.clear();
    let usedBuckets = 0;
    let collisionCount = 0;
    let grabbedCollisionCount = 0;
    let predictedGrabCollisionCount = 0;
    let maximumPenetration = 0;
    const minimumDistanceSquared =
      selfCollisionDistance * selfCollisionDistance;
    const warningDistance = selfCollisionDistance * 1.35;
    const warningDistanceSquared = warningDistance * warningDistance;

    for (let particle = 0; particle < vertexCount; particle += 1) {
      const particle3 = particle * 3;
      const cellX = Math.floor(positions[particle3] / selfCollisionDistance);
      const cellY = Math.floor(
        positions[particle3 + 1] / selfCollisionDistance,
      );
      const cellZ = Math.floor(
        positions[particle3 + 2] / selfCollisionDistance,
      );
      const particleColumn = particle % rowLength;
      const particleRow = Math.floor(particle / rowLength);

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            const nearbyParticles = spatialHash.get(
              spatialKey(
                cellX + offsetX,
                cellY + offsetY,
                cellZ + offsetZ,
              ),
            );
            if (!nearbyParticles) continue;

            for (const nearby of nearbyParticles) {
              const nearbyColumn = nearby % rowLength;
              const nearbyRow = Math.floor(nearby / rowLength);
              if (
                Math.abs(particleColumn - nearbyColumn) <= 2 &&
                Math.abs(particleRow - nearbyRow) <= 2
              ) {
                continue;
              }
              const nearby3 = nearby * 3;
              let dx = positions[particle3] - positions[nearby3];
              let dy = positions[particle3 + 1] - positions[nearby3 + 1];
              let dz = positions[particle3 + 2] - positions[nearby3 + 2];
              const distanceSquared = dx * dx + dy * dy + dz * dz;
              if (distanceSquared >= warningDistanceSquared) continue;

              const involvesGrabbedParticle =
                grabInfluence[particle] > 0.08 ||
                grabInfluence[nearby] > 0.08;
              if (distanceSquared >= minimumDistanceSquared) {
                if (!involvesGrabbedParticle) continue;
                const warningDistanceToPair = Math.sqrt(distanceSquared);
                if (warningDistanceToPair < 0.000001) continue;
                const inverseWarningDistance =
                  1 / warningDistanceToPair;
                const particleVelocityX =
                  positions[particle3] - previousPositions[particle3];
                const particleVelocityY =
                  positions[particle3 + 1] -
                  previousPositions[particle3 + 1];
                const particleVelocityZ =
                  positions[particle3 + 2] -
                  previousPositions[particle3 + 2];
                const nearbyVelocityX =
                  positions[nearby3] - previousPositions[nearby3];
                const nearbyVelocityY =
                  positions[nearby3 + 1] -
                  previousPositions[nearby3 + 1];
                const nearbyVelocityZ =
                  positions[nearby3 + 2] -
                  previousPositions[nearby3 + 2];
                const approach =
                  dx *
                    inverseWarningDistance *
                    (particleVelocityX - nearbyVelocityX) +
                  dy *
                    inverseWarningDistance *
                    (particleVelocityY - nearbyVelocityY) +
                  dz *
                    inverseWarningDistance *
                    (particleVelocityZ - nearbyVelocityZ);
                if (
                  approach < -0.0015 &&
                  warningDistanceToPair + approach <
                    selfCollisionDistance * 0.92
                ) {
                  predictedGrabCollisionCount += 1;
                }
                continue;
              }

              let distance = Math.sqrt(distanceSquared);
              if (distance < 0.000001) {
                const direction = (particle + nearby) % 2 === 0 ? 1 : -1;
                dx = direction * 0.577;
                dy = 0.577;
                dz = -direction * 0.577;
                distance = 0;
              } else {
                dx /= distance;
                dy /= distance;
                dz /= distance;
              }

              const particlePinned = pinned[particle] === 1;
              const nearbyPinned = pinned[nearby] === 1;
              if (particlePinned && nearbyPinned) continue;

              const separation =
                (selfCollisionDistance - distance) *
                selfCollisionStiffness;
              maximumPenetration = Math.max(
                maximumPenetration,
                (selfCollisionDistance - distance) /
                  selfCollisionDistance,
              );
              if (involvesGrabbedParticle) {
                grabbedCollisionCount += 1;
              }
              const particleMobility = particlePinned
                ? 0
                : 1 - grabInfluence[particle] * 0.85;
              const nearbyMobility = nearbyPinned
                ? 0
                : 1 - grabInfluence[nearby] * 0.85;
              const totalMobility =
                particleMobility + nearbyMobility;
              if (totalMobility < 0.000001) continue;
              const particleShare =
                particleMobility / totalMobility;
              const nearbyShare =
                nearbyMobility / totalMobility;
              const particleCorrection = separation * particleShare;
              const nearbyCorrection = separation * nearbyShare;

              positions[particle3] += dx * particleCorrection;
              positions[particle3 + 1] += dy * particleCorrection;
              positions[particle3 + 2] += dz * particleCorrection;
              positions[nearby3] -= dx * nearbyCorrection;
              positions[nearby3 + 1] -= dy * nearbyCorrection;
              positions[nearby3 + 2] -= dz * nearbyCorrection;

              previousPositions[particle3] +=
                dx * particleCorrection * 0.35;
              previousPositions[particle3 + 1] +=
                dy * particleCorrection * 0.35;
              previousPositions[particle3 + 2] +=
                dz * particleCorrection * 0.35;
              previousPositions[nearby3] -=
                dx * nearbyCorrection * 0.35;
              previousPositions[nearby3 + 1] -=
                dy * nearbyCorrection * 0.35;
              previousPositions[nearby3 + 2] -=
                dz * nearbyCorrection * 0.35;
              collisionCount += 1;
            }
          }
        }
      }

      const key = spatialKey(cellX, cellY, cellZ);
      const currentCell = spatialHash.get(key);
      if (currentCell) {
        currentCell.push(particle);
      } else {
        const bucket = spatialBuckets[usedBuckets] ?? [];
        bucket.length = 0;
        bucket.push(particle);
        spatialBuckets[usedBuckets] = bucket;
        usedBuckets += 1;
        spatialHash.set(key, bucket);
      }
    }

    return {
      collisionCount,
      grabbedCollisionCount,
      predictedGrabCollisionCount,
      maximumPenetration,
    };
  };

  const applyGrabConstraint = () => {
    if (!grabState) return 0;
    let maximumGrabStress = 0;
    const releaseStrength =
      autoReleaseFramesRemaining > 0
        ? autoReleaseFramesRemaining / (autoReleaseFrames + 1)
        : 1;

    for (const grabbed of grabState.particles) {
      if (pinned[grabbed.index] === 1) continue;
      const particle3 = grabbed.index * 3;
      const targetX = grabState.targetX + grabbed.offsetX;
      const targetY = grabState.targetY + grabbed.offsetY;
      const targetZ = grabState.targetZ + grabbed.offsetZ;
      const grabResponse = THREE.MathUtils.lerp(
        0.78,
        0.12,
        grabSettings.resistance,
      );
      const influence =
        grabResponse *
        (0.18 + grabbed.weight * 0.82) *
        releaseStrength;
      const correctionX =
        (targetX - positions[particle3]) * influence;
      const correctionY =
        (targetY - positions[particle3 + 1]) * influence;
      const correctionZ =
        (targetZ - positions[particle3 + 2]) * influence;
      maximumGrabStress = Math.max(
        maximumGrabStress,
        Math.hypot(
          targetX - positions[particle3],
          targetY - positions[particle3 + 1],
          targetZ - positions[particle3 + 2],
        ),
      );

      positions[particle3] += correctionX;
      positions[particle3 + 1] += correctionY;
      positions[particle3 + 2] += correctionZ;
      const previousCorrection =
        1 - grabSettings.inertia * 0.6;
      previousPositions[particle3] +=
        correctionX * previousCorrection;
      previousPositions[particle3 + 1] +=
        correctionY * previousCorrection;
      previousPositions[particle3 + 2] +=
        correctionZ * previousCorrection;
    }

    return maximumGrabStress;
  };

  const step = (
    delta: number,
    wind: WindControls,
    time: number,
    transitionGust = 0,
  ) => {
    const substeps = 2;
    const substep = Math.min(delta, 1 / 30) / substeps;
    const squaredStep = substep * substep;
    let midstepSelfCollisionRan = false;
    let maximumPenetration = 0;
    let maximumGrabbedCollisions = 0;
    let maximumPredictedGrabCollisions = 0;
    let maximumGrabStress = 0;

    for (let substepIndex = 0; substepIndex < substeps; substepIndex += 1) {
      const gustSignal =
        Math.sin(time * 0.38 + 0.6) * 0.52 +
        Math.sin(time * 0.91 + 2.1) * 0.3 +
        Math.sin(time * 1.83 + 4.2) * 0.18;
      const gustEnvelope = THREE.MathUtils.clamp(
        1 + gustSignal * wind.gustiness * 0.55,
        0.22,
        1.75,
      );
      const effectiveWind =
        (wind.strength + transitionGust * 1.35) * gustEnvelope;
      const basePressure = 1 - Math.exp(-effectiveWind * 0.82);
      const highWindPressure =
        Math.log1p(Math.max(effectiveWind - 1, 0)) * 0.48;
      const aerodynamicLoad = Math.min(
        basePressure + highWindPressure,
        3.2,
      );

      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          const particle = index(column, row);
          if (pinned[particle] === 1) continue;

          const particle3 = particle * 3;
          const normalizedColumn = column / columns;
          const normalizedRow = row / rows;
          const distanceFromAnchor = hangsFromTop
            ? normalizedRow
            : normalizedColumn;
          const currentX = positions[particle3];
          const currentY = positions[particle3 + 1];
          const currentZ = positions[particle3 + 2];
          const velocityX = (currentX - previousPositions[particle3]) * 0.976;
          const velocityY =
            (currentY - previousPositions[particle3 + 1]) * 0.976;
          const velocityZ =
            (currentZ - previousPositions[particle3 + 2]) * 0.968;

          previousPositions[particle3] = currentX;
          previousPositions[particle3 + 1] = currentY;
          previousPositions[particle3 + 2] = currentZ;

          const flutter =
            Math.sin(time * 5.2 + normalizedRow * 17 + normalizedColumn * 9) *
              0.62 +
            Math.sin(time * 8.7 - normalizedRow * 23 + normalizedColumn * 15) *
              0.38;
          const wake =
            Math.sin(
              time * 2.1 +
              (hangsFromTop ? normalizedColumn : normalizedRow) * 8.4,
            ) *
            Math.pow(distanceFromAnchor, 2.4);
          const windPull =
            aerodynamicLoad *
            (
              hangsFromTop
                ? 0.48 + distanceFromAnchor * 0.38
                : 7.4 + distanceFromAnchor * 2.4
            );
          const turbulenceForce =
            aerodynamicLoad *
            (wind.turbulence + transitionGust * 1.8) *
            (flutter * 0.62 + wake * 0.38) *
            distanceFromAnchor *
            (hangsFromTop ? 0.4 : 1.25);

          if (hangsFromTop) {
            positions[particle3] =
              currentX +
              velocityX +
              turbulenceForce * 0.08 * squaredStep;
            positions[particle3 + 1] =
              currentY +
              velocityY +
              (
                -wind.gravity * 3.15 +
                wind.direction * aerodynamicLoad * 0.34
              ) *
                squaredStep;
            positions[particle3 + 2] =
              currentZ +
              velocityZ +
              (windPull + turbulenceForce * 0.55) * squaredStep;
          } else {
            positions[particle3] =
              currentX + velocityX + windPull * squaredStep;
            positions[particle3 + 1] =
              currentY +
              velocityY +
              (
                -wind.gravity * 3.15 +
                wind.direction * aerodynamicLoad * 2.4
              ) *
                squaredStep;
            positions[particle3 + 2] =
              currentZ + velocityZ + turbulenceForce * squaredStep;
          }
        }
      }

      const constraintIterations =
        baseConstraintIterations + (tornEnabled ? 1 : 0);
      for (
        let iteration = 0;
        iteration < constraintIterations;
        iteration += 1
      ) {
        solveConstraints();
      }
      solveConstraints();

      for (const particle of pinnedVertices) {
        const pinnedVertex = particle * 3;
        positions[pinnedVertex] = restPositions[pinnedVertex];
        positions[pinnedVertex + 1] = restPositions[pinnedVertex + 1];
        positions[pinnedVertex + 2] = restPositions[pinnedVertex + 2];
      }
      maximumGrabStress = Math.max(
        maximumGrabStress,
        applyGrabConstraint(),
      );

      const useMidstepSelfCollision =
        grabState !== null &&
        (
          resolutionSpan <= 72 ||
          (substepIndex === 0 && simulationFrame % 2 === 0)
        );
      if (useMidstepSelfCollision) {
        const collisionResult = solveSelfCollisions();
        maximumPenetration = Math.max(
          maximumPenetration,
          collisionResult.maximumPenetration,
        );
        maximumGrabbedCollisions = Math.max(
          maximumGrabbedCollisions,
          collisionResult.grabbedCollisionCount,
        );
        maximumPredictedGrabCollisions = Math.max(
          maximumPredictedGrabCollisions,
          collisionResult.predictedGrabCollisionCount,
        );
        midstepSelfCollisionRan = true;
      }
    }

    simulationFrame += 1;
    const selfCollisionCadence =
      grabState !== null || resolutionSpan <= 48
        ? 1
        : resolutionSpan <= 72
          ? 2
          : 3;
    solveConstraints();
    maximumGrabStress = Math.max(
      maximumGrabStress,
      applyGrabConstraint(),
    );
    if (simulationFrame % selfCollisionCadence === 0) {
      const collisionsResolved = solveSelfCollisions();
      maximumPenetration = Math.max(
        maximumPenetration,
        collisionsResolved.maximumPenetration,
      );
      maximumGrabbedCollisions = Math.max(
        maximumGrabbedCollisions,
        collisionsResolved.grabbedCollisionCount,
      );
      maximumPredictedGrabCollisions = Math.max(
        maximumPredictedGrabCollisions,
        collisionsResolved.predictedGrabCollisionCount,
      );
      const needsAdaptiveSecondPass =
        !midstepSelfCollisionRan &&
        resolutionSpan <= 72 &&
        collisionsResolved.collisionCount >
          Math.max(12, vertexCount * 0.004);
      if (needsAdaptiveSecondPass) {
        const secondPass = solveSelfCollisions();
        maximumPenetration = Math.max(
          maximumPenetration,
          secondPass.maximumPenetration,
        );
        maximumGrabbedCollisions = Math.max(
          maximumGrabbedCollisions,
          secondPass.grabbedCollisionCount,
        );
        maximumPredictedGrabCollisions = Math.max(
          maximumPredictedGrabCollisions,
          secondPass.predictedGrabCollisionCount,
        );
      }
    }

    let releasedGrab = false;
    if (grabState && autoReleaseFramesRemaining === 0) {
      const grabbedParticleCount = grabState.particles.length;
      const collisionOverloadThreshold = Math.max(
        10,
        grabbedParticleCount * 0.24,
      );
      const imminentCollisionThreshold = Math.max(
        6,
        grabbedParticleCount * 0.12,
      );
      const catastrophicPenetration =
        maximumPenetration > 0.78 ||
        maximumGrabStress > 1.25;
      const unsafeCollision =
        (
          maximumPenetration > 0.56 &&
          maximumGrabbedCollisions >= 3
        ) ||
        (
          maximumPenetration > 0.34 &&
          maximumGrabbedCollisions >
            collisionOverloadThreshold
        ) ||
        maximumPredictedGrabCollisions >
          imminentCollisionThreshold ||
        (
          maximumGrabStress > 0.72 &&
          (
            maximumGrabbedCollisions > 0 ||
            maximumPredictedGrabCollisions > 0
          )
        ) ||
        maximumGrabStress > 0.95;

      unsafeGrabFrames = unsafeCollision
        ? unsafeGrabFrames + 1
        : Math.max(unsafeGrabFrames - 1, 0);

      if (catastrophicPenetration || unsafeGrabFrames >= 2) {
        autoReleaseFramesRemaining = autoReleaseFrames;
        for (let particle = 0; particle < vertexCount; particle += 1) {
          if (pinned[particle] === 1) continue;
          const particle3 = particle * 3;
          const velocityRetention = THREE.MathUtils.lerp(
            0.48,
            0.12,
            grabInfluence[particle],
          );
          previousPositions[particle3] =
            positions[particle3] -
            (
              positions[particle3] -
              previousPositions[particle3]
            ) *
              velocityRetention;
          previousPositions[particle3 + 1] =
            positions[particle3 + 1] -
            (
              positions[particle3 + 1] -
              previousPositions[particle3 + 1]
            ) *
              velocityRetention;
          previousPositions[particle3 + 2] =
            positions[particle3 + 2] -
            (
              positions[particle3 + 2] -
              previousPositions[particle3 + 2]
            ) *
              velocityRetention;
        }
        unsafeGrabFrames = 0;
        releasedGrab = true;
      }
    } else if (!grabState) {
      unsafeGrabFrames = 0;
    }

    if (autoReleaseFramesRemaining > 0) {
      autoReleaseFramesRemaining -= 1;
      if (autoReleaseFramesRemaining === 0) {
        grabState = null;
        grabInfluence.fill(0);
      }
    }

    const columnSampleStep = Math.max(1, Math.floor(columns / 12));
    const rowSampleStep = Math.max(1, Math.floor(rows / 8));
    const sampleTime = Math.max(substep, 1 / 240);
    let velocitySum = 0;
    let absoluteVelocitySum = 0;
    let audioSamples = 0;

    if (hangsFromTop) {
      const firstSampleRow = Math.floor(rows * 0.55);
      for (
        let row = firstSampleRow;
        row <= rows;
        row += rowSampleStep
      ) {
        for (
          let column = 0;
          column <= columns;
          column += columnSampleStep
        ) {
          const particle3 = index(column, row) * 3;
          const velocityZ =
            (
              positions[particle3 + 2] -
              previousPositions[particle3 + 2]
            ) /
            sampleTime;
          velocitySum += velocityZ;
          absoluteVelocitySum += Math.abs(velocityZ);
          audioSamples += 1;
        }
      }
    } else {
      const firstSampleColumn = Math.floor(columns * 0.55);
      for (let row = 0; row <= rows; row += rowSampleStep) {
        for (
          let column = firstSampleColumn;
          column <= columns;
          column += columnSampleStep
        ) {
          const particle3 = index(column, row) * 3;
          const velocityZ =
            (
              positions[particle3 + 2] -
              previousPositions[particle3 + 2]
            ) /
            sampleTime;
          velocitySum += velocityZ;
          absoluteVelocitySum += Math.abs(velocityZ);
          audioSamples += 1;
        }
      }
    }

    const freeEdgeVelocity = velocitySum / Math.max(audioSamples, 1);
    const meanMotion = absoluteVelocitySum / Math.max(audioSamples, 1);
    const motion = 1 - Math.exp(-meanMotion * 0.42);
    const velocityChange = Math.abs(
      freeEdgeVelocity - lastFreeEdgeVelocity,
    );
    const reversedDirection =
      freeEdgeVelocity * lastFreeEdgeVelocity < -0.012;
    const reversalImpact = reversedDirection
      ? Math.min(velocityChange * 0.22, 1)
      : 0;
    const motionSurge = Math.max(motion - lastMotionEnergy - 0.035, 0) * 1.6;
    const impact = THREE.MathUtils.clamp(
      reversalImpact + motionSurge,
      0,
      1,
    );
    lastFreeEdgeVelocity = freeEdgeVelocity;
    lastMotionEnergy = motion;

    geometry.computeVertexNormals();
    positionAttribute.needsUpdate = true;
    geometry.getAttribute("normal").needsUpdate = true;
    return {
      motion,
      impact,
      releasedGrab,
    } satisfies ClothStepMetrics;
  };

  const poke = (u: number, v: number, strength = 0.32) => {
    const radius = 0.2;
    const aspectCorrection = layout.width / layout.height;

    for (let particle = 0; particle < vertexCount; particle += 1) {
      if (pinned[particle] === 1) continue;
      const deltaU = (uvAttribute.getX(particle) - u) * aspectCorrection;
      const deltaV = uvAttribute.getY(particle) - v;
      const distance = Math.hypot(deltaU, deltaV);
      if (distance >= radius) continue;

      const normalizedDistance = distance / radius;
      const falloff =
        Math.cos(normalizedDistance * Math.PI * 0.5) ** 2;
      const particle3 = particle * 3;
      positions[particle3 + 2] -= strength * falloff * 0.18;
      previousPositions[particle3 + 2] +=
        strength * falloff * 0.32;
    }

    geometry.computeVertexNormals();
    positionAttribute.needsUpdate = true;
    geometry.getAttribute("normal").needsUpdate = true;
  };

  const beginGrab = (
    u: number,
    v: number,
    targetX: number,
    targetY: number,
    targetZ: number,
  ) => {
    const radius = grabSettings.radius;
    const aspectCorrection = layout.width / layout.height;
    const particles: NonNullable<typeof grabState>["particles"] = [];
    grabInfluence.fill(0);

    for (let particle = 0; particle < vertexCount; particle += 1) {
      if (pinned[particle] === 1) continue;
      const deltaU =
        (uvAttribute.getX(particle) - u) * aspectCorrection;
      const deltaV = uvAttribute.getY(particle) - v;
      const distance = Math.hypot(deltaU, deltaV);
      if (distance >= radius) continue;

      const normalizedDistance = distance / radius;
      const weight =
        Math.cos(normalizedDistance * Math.PI * 0.5) ** 2;
      const particle3 = particle * 3;
      grabInfluence[particle] = weight;
      particles.push({
        index: particle,
        offsetX: positions[particle3] - targetX,
        offsetY: positions[particle3 + 1] - targetY,
        offsetZ: positions[particle3 + 2] - targetZ,
        weight,
      });
      previousPositions[particle3] = positions[particle3];
      previousPositions[particle3 + 1] = positions[particle3 + 1];
      previousPositions[particle3 + 2] = positions[particle3 + 2];
    }

    if (particles.length === 0) return false;
    grabState = {
      targetX,
      targetY,
      targetZ,
      particles,
    };
    unsafeGrabFrames = 0;
    autoReleaseFramesRemaining = 0;
    return true;
  };

  const moveGrab = (targetX: number, targetY: number, targetZ: number) => {
    if (!grabState) return;
    grabState.targetX = targetX;
    grabState.targetY = targetY;
    grabState.targetZ = targetZ;
  };

  const releaseGrab = () => {
    grabState = null;
    grabInfluence.fill(0);
    unsafeGrabFrames = 0;
    autoReleaseFramesRemaining = 0;
  };

  const setGrabSettings = (settings: GrabControls) => {
    grabSettings = { ...settings };
  };

  reset();
  return {
    reset,
    step,
    poke,
    beginGrab,
    moveGrab,
    releaseGrab,
    setGrabSettings,
    setTorn: (enabled: boolean) => {
      tornEnabled = enabled;
    },
  };
}

export function FlagStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const designSwitcherRef = useRef<HTMLElement>(null);
  const identityMotionRef = useRef<HTMLDivElement>(null);
  const navigationPressAnimationRef = useRef<Animation | null>(null);
  const identityTapAnimationsRef = useRef<Animation[]>([]);
  const identityTapTimerRef = useRef<number | null>(null);
  const identityTapStreakRef = useRef({
    count: 0,
    lastTap: 0,
  });
  const navigationDragRef = useRef({
    pointerId: null as number | null,
    startX: 0,
    dragged: false,
    lastDesignId: null as string | null,
  });
  const suppressNavigationClickRef = useRef(false);
  const activeDesignRef = useRef<string | null>(INITIAL_DESIGN.id);
  const previousDesignTimerRef = useRef<number | null>(null);
  const artworkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const artworkImageRef = useRef<HTMLImageElement | null>(null);
  const artworkScaleRef = useRef(INITIAL_ARTWORK_SCALE);
  const designArtworkScalesRef = useRef<Record<string, number>>(
    Object.fromEntries(
      DESIGN_PRESETS.map((design) => [design.id, INITIAL_ARTWORK_SCALE]),
    ),
  );
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const uniformsRef = useRef<Record<string, THREE.IUniform> | null>(null);
  const designTransitionRef = useRef<DesignTransition>(() => undefined);
  const backgroundTransitionRef = useRef<
    (palette: ProceduralBackgroundPalette) => void
  >(() => undefined);
  const backgroundParametersRef = useRef<
    (controls: BackgroundControls) => void
  >(() => undefined);
  const backgroundSettingsByDesignRef = useRef<
    Record<string, BackgroundControls>
  >({
    ...Object.fromEntries(
      DESIGN_PRESETS.map((design) => [
        design.id,
        getBackgroundControls(design.background),
      ]),
    ),
    custom: getBackgroundControls(CUSTOM_BACKGROUND_PALETTE),
  });
  const advanceDesignRef = useRef<
    (origin?: TransitionOrigin) => void
  >(() => undefined);
  const navigateDesignRef = useRef<(offset: number) => void>(
    () => undefined,
  );
  const clothPokeRef = useRef<(u: number, v: number) => void>(
    () => undefined,
  );
  const clothGrabRef = useRef<ClothGrabController>({
    begin: () => false,
    move: () => undefined,
    end: () => undefined,
    configure: () => undefined,
  });
  const grabSettingsRef = useRef(INITIAL_GRAB);
  const transitionModeRef = useRef<TransitionMode>(
    INITIAL_TRANSITION_MODE,
  );
  const transitionGustRef = useRef(0);
  const windRef = useRef(INITIAL_WIND);
  const clothAudioRef = useRef<ClothAudioMetrics>({ motion: 0, impact: 0 });
  const windAudioRef = useRef<WindAudioEngine | null>(null);
  const windSoundRef = useRef(INITIAL_WIND_SOUND);
  const windLayerEnabledRef = useRef(false);
  const clothLayerEnabledRef = useRef(false);
  const designLoadRef = useRef(0);
  const tearModeUpdaterRef = useRef<(enabled: boolean) => void>(
    () => undefined,
  );
  const simulationResetRef = useRef<() => void>(() => undefined);
  const resizeStageRef = useRef<() => void>(() => undefined);
  const pauseRef = useRef(false);
  const simulationSettingsRef = useRef({
    wind: INITIAL_WIND,
    flagSize: INITIAL_FLAG_SIZE,
    material: INITIAL_MATERIAL,
    lighting: INITIAL_LIGHTING,
    color: INITIAL_DESIGN.color,
    activeDesign: INITIAL_DESIGN.id as string | null,
    premiereLightsEnabled: true,
  });
  const [wind, setWind] = useState(INITIAL_WIND);
  const [flagSize, setFlagSize] = useState(INITIAL_FLAG_SIZE);
  const [artworkScale, setArtworkScale] = useState(INITIAL_ARTWORK_SCALE);
  const [materialSettings, setMaterialSettings] = useState(INITIAL_MATERIAL);
  const [grabSettings, setGrabSettings] = useState(INITIAL_GRAB);
  const [lighting, setLighting] = useState(INITIAL_LIGHTING);
  const [backgroundSettings, setBackgroundSettings] =
    useState<BackgroundControls>(
      getBackgroundControls(INITIAL_DESIGN.background),
    );
  const [color, setColor] = useState(INITIAL_DESIGN.color);
  const [activeDesign, setActiveDesign] = useState<string | null>(
    INITIAL_DESIGN.id,
  );
  const [previousDesign, setPreviousDesign] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [activeControlTab, setActiveControlTab] =
    useState<ControlTab>("motion");
  const [meshQuality, setMeshQuality] = useState<MeshQuality>(
    INITIAL_MESH_QUALITY,
  );
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(
    INITIAL_TRANSITION_MODE,
  );
  const [tornMode, setTornMode] = useState(false);
  const [premiereLightsEnabled, setPremiereLightsEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isNavigationDragging, setIsNavigationDragging] = useState(false);
  const [windSoundEnabled, setWindSoundEnabled] = useState(false);
  const [clothSoundEnabled, setClothSoundEnabled] = useState(false);
  const [windSound, setWindSound] = useState(INITIAL_WIND_SOUND);
  const [artworkName, setArtworkName] = useState(INITIAL_DESIGN.label);
  const [usesPortraitCloth, setUsesPortraitCloth] = useState(
    () => window.matchMedia(MOBILE_PORTRAIT_QUERY).matches,
  );

  useEffect(() => {
    const portraitQuery = window.matchMedia(MOBILE_PORTRAIT_QUERY);
    const updateClothOrientation = () => {
      setUsesPortraitCloth(portraitQuery.matches);
    };

    updateClothOrientation();
    portraitQuery.addEventListener("change", updateClothOrientation);
    return () => {
      portraitQuery.removeEventListener(
        "change",
        updateClothOrientation,
      );
    };
  }, []);

  useEffect(() => {
    const activePreset = DESIGN_PRESETS.find(
      (design) => design.id === activeDesign,
    );
    const backgroundColor = activePreset?.identityBackground ?? "#0b0b0c";
    const themeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );

    document.documentElement.style.setProperty(
      "--background",
      backgroundColor,
    );
    themeColor?.setAttribute("content", backgroundColor);
    const palette =
      activePreset?.background ?? CUSTOM_BACKGROUND_PALETTE;
    const settingsKey = activePreset?.id ?? "custom";
    const storedSettings =
      backgroundSettingsByDesignRef.current[settingsKey] ??
      getBackgroundControls(palette);
    setBackgroundSettings({ ...storedSettings });
    backgroundTransitionRef.current({
      ...palette,
      ...storedSettings,
    });
  }, [activeDesign]);

  useEffect(() => {
    simulationSettingsRef.current = {
      wind,
      flagSize,
      material: materialSettings,
      lighting,
      color,
      activeDesign,
      premiereLightsEnabled,
    };
  }, [
    activeDesign,
    color,
    flagSize,
    lighting,
    materialSettings,
    premiereLightsEnabled,
    wind,
  ]);

  useEffect(() => {
    for (const design of DESIGN_PRESETS) {
      if (designImageCache.has(design.asset)) continue;
      const image = new Image();
      designImageCache.set(design.asset, image);
      image.src = design.asset;
    }

    return () => {
      navigationPressAnimationRef.current?.cancel();
      navigationPressAnimationRef.current = null;
      for (const animation of identityTapAnimationsRef.current) {
        animation.cancel();
      }
      identityTapAnimationsRef.current = [];
      if (identityTapTimerRef.current !== null) {
        window.clearTimeout(identityTapTimerRef.current);
      }
      if (previousDesignTimerRef.current !== null) {
        window.clearTimeout(previousDesignTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleDesignArrowKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        return;
      }

      event.preventDefault();
      navigateDesignRef.current(
        event.key === "ArrowRight" ? 1 : -1,
      );
    };

    window.addEventListener("keydown", handleDesignArrowKey);
    return () => {
      window.removeEventListener("keydown", handleDesignArrowKey);
    };
  }, []);

  useEffect(() => {
    const handleControlsShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      setControlsOpen((isOpen) => !isOpen);
    };

    window.addEventListener("keydown", handleControlsShortcut);
    return () => {
      window.removeEventListener("keydown", handleControlsShortcut);
    };
  }, []);

  useEffect(() => {
    const character = identityMotionRef.current;
    if (
      !character ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let animationFrame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let inactivityTimer = 0;

    const animateLook = () => {
      currentX += (targetX - currentX) * 0.16;
      currentY += (targetY - currentY) * 0.16;
      character.style.setProperty("--eye-x", `${currentX * 2.4}px`);
      const eyeYRange = currentY < 0 ? 2.35 : 1.7;
      character.style.setProperty("--eye-y", `${currentY * eyeYRange}px`);

      if (
        Math.abs(targetX - currentX) > 0.002 ||
        Math.abs(targetY - currentY) > 0.002
      ) {
        animationFrame = window.requestAnimationFrame(animateLook);
      } else {
        animationFrame = 0;
      }
    };

    const requestLookUpdate = () => {
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(animateLook);
      }
    };

    const lookAtPointer = (pointerX: number, pointerY: number) => {
      const activeIdentity = character.querySelector<HTMLElement>(
        ".identity-character-selected",
      );
      const bounds = (activeIdentity ?? character).getBoundingClientRect();
      const pointerIsAbove = pointerY < bounds.top;
      const deltaX = pointerX - (bounds.left + bounds.width / 2);
      const deltaY = pointerY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(deltaX, deltaY);

      if (distance < 4) {
        targetX = 0;
        targetY = 0;
      } else {
        targetX = deltaX / distance;
        targetY = pointerIsAbove ? -1 : deltaY / distance;
      }
      requestLookUpdate();
    };

    const scheduleInterestLoss = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        targetX = Math.random() < 0.5 ? -0.38 : 0.38;
        targetY = 0.12;
        requestLookUpdate();
      }, 1000);
    };

    const handleIdentityPointer = (event: PointerEvent) => {
      lookAtPointer(event.clientX, event.clientY);
      scheduleInterestLoss();
    };

    const resetIdentityLook = () => {
      window.clearTimeout(inactivityTimer);
      targetX = 0;
      targetY = 0;
      requestLookUpdate();
    };

    scheduleInterestLoss();
    window.addEventListener("pointermove", handleIdentityPointer, {
      passive: true,
    });
    window.addEventListener("blur", resetIdentityLook);
    document.documentElement.addEventListener(
      "pointerleave",
      resetIdentityLook,
    );

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(inactivityTimer);
      window.removeEventListener("pointermove", handleIdentityPointer);
      window.removeEventListener("blur", resetIdentityLook);
      document.documentElement.removeEventListener(
        "pointerleave",
        resetIdentityLook,
      );
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const clothLayout = usesPortraitCloth
      ? PORTRAIT_CLOTH
      : LANDSCAPE_CLOTH;
    const settings = simulationSettingsRef.current;
    setIsLoading(true);
    let disposed = false;
    let hasRendered = false;
    let artworkReady = false;
    const completeLoading = () => {
      if (!disposed && hasRendered && artworkReady) {
        window.requestAnimationFrame(() => {
          if (!disposed) setIsLoading(false);
        });
      }
    };

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(usesPortraitCloth ? 0 : 0.15, 0, 6.6);
    const initialBackgroundPalette =
      DESIGN_PRESETS.find(
        (design) => design.id === settings.activeDesign,
      )?.background ?? CUSTOM_BACKGROUND_PALETTE;
    const initialBackgroundKey = settings.activeDesign ?? "custom";
    const initialBackground = {
      ...initialBackgroundPalette,
      ...(
        backgroundSettingsByDesignRef.current[
          initialBackgroundKey
        ] ?? getBackgroundControls(initialBackgroundPalette)
      ),
    };
    const backgroundUniforms: Record<string, THREE.IUniform> = {
      uBackgroundResolution: { value: new THREE.Vector2(1, 1) },
      uBackgroundPointer: { value: new THREE.Vector2() },
      uBackgroundTime: { value: 0 },
      uBackgroundMotion: { value: prefersReducedMotion ? 0 : 1 },
      uBackgroundMix: { value: 1 },
      uBackgroundFromEdge: {
        value: new THREE.Color(initialBackground.edge),
      },
      uBackgroundFromA: {
        value: new THREE.Color(initialBackground.colors[0]),
      },
      uBackgroundFromB: {
        value: new THREE.Color(initialBackground.colors[1]),
      },
      uBackgroundFromC: {
        value: new THREE.Color(initialBackground.colors[2]),
      },
      uBackgroundFromParams: {
        value: new THREE.Vector4(
          initialBackground.speed,
          initialBackground.seed,
          initialBackground.warp,
          initialBackground.intensity,
        ),
      },
      uBackgroundToEdge: {
        value: new THREE.Color(initialBackground.edge),
      },
      uBackgroundToA: {
        value: new THREE.Color(initialBackground.colors[0]),
      },
      uBackgroundToB: {
        value: new THREE.Color(initialBackground.colors[1]),
      },
      uBackgroundToC: {
        value: new THREE.Color(initialBackground.colors[2]),
      },
      uBackgroundToParams: {
        value: new THREE.Vector4(
          initialBackground.speed,
          initialBackground.seed,
          initialBackground.warp,
          initialBackground.intensity,
        ),
      },
    };
    const backgroundScene = new THREE.Scene();
    const backgroundCamera = new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      0,
      1,
    );
    const backgroundGeometry = new THREE.PlaneGeometry(2, 2);
    const backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: backgroundUniforms,
      vertexShader: proceduralBackgroundVertexShader,
      fragmentShader: proceduralBackgroundFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const backgroundMesh = new THREE.Mesh(
      backgroundGeometry,
      backgroundMaterial,
    );
    backgroundMesh.frustumCulled = false;
    backgroundScene.add(backgroundMesh);
    const backgroundRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    backgroundRenderTarget.texture.generateMipmaps = false;
    const backgroundCompositeScene = new THREE.Scene();
    const backgroundCompositeGeometry = new THREE.PlaneGeometry(2, 2);
    const backgroundCompositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBackgroundTexture: {
          value: backgroundRenderTarget.texture,
        },
      },
      vertexShader: proceduralBackgroundVertexShader,
      fragmentShader: proceduralBackgroundCompositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const backgroundCompositeMesh = new THREE.Mesh(
      backgroundCompositeGeometry,
      backgroundCompositeMaterial,
    );
    backgroundCompositeMesh.frustumCulled = false;
    backgroundCompositeScene.add(backgroundCompositeMesh);
    renderer.autoClear = false;

    const backgroundColorKeys = ["Edge", "A", "B", "C"] as const;
    let backgroundTransitionFrame = 0;
    let backgroundRenderFrame = 0;
    let backgroundNeedsRender = true;
    backgroundTransitionRef.current = (nextPalette) => {
      window.cancelAnimationFrame(backgroundTransitionFrame);
      const currentMix = THREE.MathUtils.clamp(
        backgroundUniforms.uBackgroundMix.value,
        0,
        1,
      );

      for (const key of backgroundColorKeys) {
        const fromColor = backgroundUniforms[
          `uBackgroundFrom${key}`
        ].value as THREE.Color;
        const toColor = backgroundUniforms[
          `uBackgroundTo${key}`
        ].value as THREE.Color;
        fromColor.lerp(toColor, currentMix);
      }
      (
        backgroundUniforms.uBackgroundFromParams
          .value as THREE.Vector4
      ).lerp(
        backgroundUniforms.uBackgroundToParams
          .value as THREE.Vector4,
        currentMix,
      );

      (
        backgroundUniforms.uBackgroundToEdge.value as THREE.Color
      ).set(nextPalette.edge);
      (
        backgroundUniforms.uBackgroundToA.value as THREE.Color
      ).set(nextPalette.colors[0]);
      (
        backgroundUniforms.uBackgroundToB.value as THREE.Color
      ).set(nextPalette.colors[1]);
      (
        backgroundUniforms.uBackgroundToC.value as THREE.Color
      ).set(nextPalette.colors[2]);
      (
        backgroundUniforms.uBackgroundToParams.value as THREE.Vector4
      ).set(
        nextPalette.speed,
        nextPalette.seed,
        nextPalette.warp,
        nextPalette.intensity,
      );

      if (prefersReducedMotion) {
        backgroundUniforms.uBackgroundMix.value = 1;
        return;
      }

      backgroundUniforms.uBackgroundMix.value = 0;
      const startedAt = performance.now();
      const duration = 1080;
      const animateBackgroundTransition = (now: number) => {
        const progress = THREE.MathUtils.clamp(
          (now - startedAt) / duration,
          0,
          1,
        );
        backgroundUniforms.uBackgroundMix.value =
          1 - Math.pow(1 - progress, 3);
        if (progress < 1) {
          backgroundTransitionFrame = window.requestAnimationFrame(
            animateBackgroundTransition,
          );
        }
      };
      backgroundTransitionFrame = window.requestAnimationFrame(
        animateBackgroundTransition,
      );
    };
    backgroundParametersRef.current = (controls) => {
      const targetParams =
        backgroundUniforms.uBackgroundToParams
          .value as THREE.Vector4;
      targetParams.x = controls.speed;
      targetParams.z = controls.warp;
      targetParams.w = controls.intensity;
      backgroundNeedsRender = true;
    };

    const baseResolution = MESH_RESOLUTIONS[meshQuality];
    const columns = usesPortraitCloth
      ? baseResolution.rows
      : baseResolution.columns;
    const rows = usesPortraitCloth
      ? baseResolution.columns
      : baseResolution.rows;

    const geometry = new THREE.PlaneGeometry(
      clothLayout.width,
      clothLayout.height,
      columns,
      rows,
    );
    const intactIndex = geometry.getIndex()?.clone() ?? null;
    const tornIndex = createTornIndex(
      geometry,
      columns,
      rows,
      clothLayout.anchor,
    );
    if (!intactIndex || !tornIndex) return;
    const clothSimulation = createClothSimulation(
      geometry,
      columns,
      rows,
      clothLayout,
    );
    const intactClothEdge = createClothEdgeGeometry(
      geometry,
      intactIndex,
    );
    const tornClothEdge = createClothEdgeGeometry(geometry, tornIndex);
    let activeClothEdge = intactClothEdge;
    simulationResetRef.current = () => {
      clothSimulation.reset();
      activeClothEdge.update();
    };
    clothPokeRef.current = (u, v) => {
      clothSimulation.poke(u, v);
      activeClothEdge.update();
    };
    clothGrabRef.current = {
      begin: (u, v, x, y, z) =>
        clothSimulation.beginGrab(u, v, x, y, z),
      move: (x, y, z) => clothSimulation.moveGrab(x, y, z),
      end: () => clothSimulation.releaseGrab(),
      configure: (settings) =>
        clothSimulation.setGrabSettings(settings),
    };
    clothSimulation.setGrabSettings(grabSettingsRef.current);
    const artworkCanvas = createEmptyArtwork(clothLayout);
    artworkCanvasRef.current = artworkCanvas;
    const artworkTexture = new THREE.CanvasTexture(artworkCanvas);
    artworkTexture.colorSpace = THREE.SRGBColorSpace;
    artworkTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    artworkTexture.wrapS = THREE.ClampToEdgeWrapping;
    artworkTexture.wrapT = THREE.ClampToEdgeWrapping;
    textureRef.current = artworkTexture;
    const previousArtworkCanvas = document.createElement("canvas");
    previousArtworkCanvas.width = artworkCanvas.width;
    previousArtworkCanvas.height = artworkCanvas.height;
    const previousArtworkTexture = new THREE.CanvasTexture(
      previousArtworkCanvas,
    );
    previousArtworkTexture.colorSpace = THREE.SRGBColorSpace;
    previousArtworkTexture.anisotropy = artworkTexture.anisotropy;
    previousArtworkTexture.wrapS = THREE.ClampToEdgeWrapping;
    previousArtworkTexture.wrapT = THREE.ClampToEdgeWrapping;
    const copyCurrentArtworkToPrevious = () => {
      const context = previousArtworkCanvas.getContext("2d");
      if (!context) return;
      context.clearRect(
        0,
        0,
        previousArtworkCanvas.width,
        previousArtworkCanvas.height,
      );
      context.drawImage(artworkCanvas, 0, 0);
      previousArtworkTexture.needsUpdate = true;
    };

    const existingArtworkImage = artworkImageRef.current;
    if (existingArtworkImage) {
      drawArtworkImage(
        artworkCanvas,
        existingArtworkImage,
        artworkScaleRef.current,
      );
      artworkTexture.needsUpdate = true;
      copyCurrentArtworkToPrevious();
      artworkReady = true;
    } else {
      const selectedDesign =
        DESIGN_PRESETS.find(
          (design) => design.id === settings.activeDesign,
        ) ??
        INITIAL_DESIGN;
      const initialLoadToken = ++designLoadRef.current;
      const initialImage =
        designImageCache.get(selectedDesign.asset) ?? new Image();
      initialImage.onload = () => {
        if (designLoadRef.current !== initialLoadToken) return;
        designImageCache.set(selectedDesign.asset, initialImage);
        artworkImageRef.current = initialImage;
        drawArtworkImage(
          artworkCanvas,
          initialImage,
          artworkScaleRef.current,
        );
        artworkTexture.needsUpdate = true;
        copyCurrentArtworkToPrevious();
        setArtworkName(selectedDesign.label);
        artworkReady = true;
        completeLoading();
      };
      initialImage.onerror = () => {
        if (designLoadRef.current !== initialLoadToken) return;
        artworkReady = true;
        completeLoading();
      };
      if (initialImage.complete && initialImage.naturalWidth > 0) {
        initialImage.onload?.(new Event("load"));
      } else if (!initialImage.src) {
        initialImage.src = selectedDesign.asset;
      }
    }

    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uStrength: {
        value: prefersReducedMotion
          ? settings.wind.strength * 0.35
          : settings.wind.strength,
      },
      uTurbulence: { value: settings.wind.turbulence },
      uDirection: { value: settings.wind.direction },
      uSpeed: {
        value: prefersReducedMotion
          ? settings.wind.speed * 0.4
          : settings.wind.speed,
      },
      uGravity: { value: settings.wind.gravity },
      uGustiness: { value: settings.wind.gustiness },
      uFlagSize: { value: settings.flagSize },
      uTransitionScale: { value: 1 },
      uColor: { value: new THREE.Color(settings.color) },
      uPreviousColor: { value: new THREE.Color(settings.color) },
      uArtwork: { value: artworkTexture },
      uPreviousArtwork: { value: previousArtworkTexture },
      uDesignTransition: { value: 1 },
      uTransitionDirection: { value: 1 },
      uTransitionMode: {
        value: getTransitionModeValue(transitionModeRef.current),
      },
      uTransitionSeed: { value: 0 },
      uTransitionOrigin: {
        value: new THREE.Vector2(
          DEFAULT_TRANSITION_ORIGIN.x,
          DEFAULT_TRANSITION_ORIGIN.y,
        ),
      },
      uTransitionScreenOrigin: {
        value: new THREE.Vector2(
          DEFAULT_TRANSITION_ORIGIN.screenX ?? 0.5,
          1 - (DEFAULT_TRANSITION_ORIGIN.screenY ?? 0.5),
        ),
      },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uFabricPreset: { value: settings.material.preset },
      uTextureScale: { value: settings.material.scale },
      uThickness: { value: settings.material.thickness },
      uNormalStrength: { value: settings.material.normalStrength },
      uBumpStrength: { value: settings.material.bumpStrength },
      uRoughness: { value: settings.material.roughness },
      uAmbientIntensity: { value: settings.lighting.ambient },
      uKeyIntensity: { value: settings.lighting.keyIntensity },
      uLightX: { value: settings.lighting.horizontal },
      uLightY: { value: settings.lighting.vertical },
      uLightZ: { value: settings.lighting.depth },
      uRimIntensity: { value: settings.lighting.rimIntensity },
      uLightColor: { value: new THREE.Color(settings.lighting.color) },
      uPremiereActive: {
        value:
          settings.activeDesign === "popcorn" &&
          settings.premiereLightsEnabled
            ? 1
            : 0,
      },
      uPremiereIntensity: {
        value: settings.lighting.premiereIntensity,
      },
      uPremiereSpeed: { value: settings.lighting.premiereSpeed },
      uClothSize: {
        value: new THREE.Vector2(
          clothLayout.width,
          clothLayout.height,
        ),
      },
    };
    uniformsRef.current = uniforms;
    let designTransitionFrame = 0;
    designTransitionRef.current = (
      image,
      nextColor,
      nextArtworkScale,
      direction,
      origin,
    ) => {
      window.cancelAnimationFrame(designTransitionFrame);
      transitionGustRef.current = 0;
      copyCurrentArtworkToPrevious();
      uniforms.uPreviousColor.value.copy(uniforms.uColor.value);
      drawArtworkImage(artworkCanvas, image, nextArtworkScale);
      artworkTexture.needsUpdate = true;
      uniforms.uColor.value.set(nextColor);
      uniforms.uTransitionDirection.value = direction >= 0 ? 1 : -1;
      const isLogoTransition =
        transitionModeRef.current === "logo";
      uniforms.uTransitionMode.value =
        getTransitionModeValue(transitionModeRef.current);
      uniforms.uTransitionSeed.value =
        (uniforms.uTransitionSeed.value + 1.731) % 19;
      const safeOrigin = origin ?? DEFAULT_TRANSITION_ORIGIN;
      uniforms.uTransitionOrigin.value.set(
        safeOrigin.x,
        safeOrigin.y,
      );
      uniforms.uTransitionScreenOrigin.value.set(
        safeOrigin.screenX ?? 0.5,
        1 - (safeOrigin.screenY ?? 0.5),
      );

      if (prefersReducedMotion) {
        uniforms.uDesignTransition.value = 1;
        uniforms.uTransitionScale.value = 1;
        return;
      }

      uniforms.uDesignTransition.value = 0;
      uniforms.uTransitionScale.value = 1;
      const startedAt = performance.now();
      const duration = 820;
      const animateTransition = (now: number) => {
        const progress = THREE.MathUtils.clamp(
          (now - startedAt) / duration,
          0,
          1,
        );
        const easedProgress =
          progress * progress * (3 - 2 * progress);
        uniforms.uDesignTransition.value = isLogoTransition
          ? progress
          : easedProgress;

        if (isLogoTransition) {
          uniforms.uTransitionScale.value = 1;
          transitionGustRef.current = 0;
        } else {
          if (progress < 0.24) {
            const contraction = progress / 0.24;
            const easedContraction =
              1 - Math.pow(1 - contraction, 3);
            uniforms.uTransitionScale.value =
              1 - easedContraction * 0.07;
          } else {
            const recovery = (progress - 0.24) / 0.76;
            const easedRecovery = 1 - Math.pow(1 - recovery, 3);
            const softOvershoot =
              Math.sin(recovery * Math.PI) * 0.01;
            uniforms.uTransitionScale.value =
              0.93 + easedRecovery * 0.07 + softOvershoot;
          }

          const gustProgress = THREE.MathUtils.clamp(
            (progress - 0.62) / 0.38,
            0,
            1,
          );
          transitionGustRef.current =
            Math.sin(gustProgress * Math.PI) * 1.15;
        }

        if (progress < 1) {
          designTransitionFrame =
            window.requestAnimationFrame(animateTransition);
        } else {
          uniforms.uDesignTransition.value = 1;
          uniforms.uTransitionScale.value = 1;
          transitionGustRef.current = 0;
        }
      };
      designTransitionFrame =
        window.requestAnimationFrame(animateTransition);
    };

    const frontMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.FrontSide,
      defines: {
        SURFACE_DIRECTION: "1.0",
        SURFACE_SHADE: "1.0",
      },
    });

    const backMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      defines: {
        SURFACE_DIRECTION: "-1.0",
        SURFACE_SHADE: "0.88",
      },
    });

    const edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFlagSize: uniforms.uFlagSize,
        uThickness: uniforms.uThickness,
        uTransitionScale: uniforms.uTransitionScale,
        uColor: uniforms.uColor,
        uAmbientIntensity: uniforms.uAmbientIntensity,
        uKeyIntensity: uniforms.uKeyIntensity,
        uLightX: uniforms.uLightX,
        uLightY: uniforms.uLightY,
        uLightZ: uniforms.uLightZ,
        uLightColor: uniforms.uLightColor,
      },
      vertexShader: edgeVertexShader,
      fragmentShader: edgeFragmentShader,
      side: THREE.DoubleSide,
    });

    const flag = new THREE.Group();
    const frontSurface = new THREE.Mesh(geometry, frontMaterial);
    const backSurface = new THREE.Mesh(geometry, backMaterial);
    const edgeSurface = new THREE.Mesh(
      intactClothEdge.geometry,
      edgeMaterial,
    );
    frontSurface.frustumCulled = false;
    backSurface.frustumCulled = false;
    edgeSurface.frustumCulled = false;
    flag.add(frontSurface, backSurface, edgeSurface);
    flag.rotation.x = -0.025;
    flag.rotation.y = usesPortraitCloth ? -0.08 : -0.12;
    flag.position.y = usesPortraitCloth ? -0.04 : 0;
    scene.add(flag);
    tearModeUpdaterRef.current = (enabled: boolean) => {
      geometry.setIndex(enabled ? tornIndex : intactIndex);
      clothSimulation.setTorn(enabled);
      activeClothEdge = enabled ? tornClothEdge : intactClothEdge;
      edgeSurface.geometry = activeClothEdge.geometry;
      clothSimulation.reset();
      activeClothEdge.update();
      geometry.computeBoundingSphere();
    };

    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const tapPointer = new THREE.Vector2();
    const tapRaycaster = new THREE.Raycaster();
    const dragPlane = new THREE.Plane();
    const dragPlaneNormal = new THREE.Vector3();
    const dragWorldPoint = new THREE.Vector3();
    const tapStart = {
      pointerId: null as number | null,
      x: 0,
      y: 0,
      u: 0.5,
      v: 0.5,
      screenX: 0.5,
      screenY: 0.5,
      grabbed: false,
    };
    const timer = new THREE.Timer();
    timer.connect(document);
    let animationFrame = 0;
    let simulationTime = 0;
    let fpsFrames = 0;
    let fpsElapsed = 0;
    let renderScale = 1;
    let lowFpsIntervals = 0;
    let highFpsIntervals = 0;
    const drawingBufferSize = new THREE.Vector2();

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const maximumPixelRatio = Math.min(
        window.devicePixelRatio,
        width < 780 ? 1.05 : 1.25,
      );
      renderer.setPixelRatio(
        Math.max(0.75, maximumPixelRatio * renderScale),
      );
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(drawingBufferSize);
      uniforms.uViewport.value.copy(drawingBufferSize);
      const backgroundScale = width < 780 ? 0.48 : 0.62;
      const backgroundWidth = Math.max(
        1,
        Math.round(drawingBufferSize.x * backgroundScale),
      );
      const backgroundHeight = Math.max(
        1,
        Math.round(drawingBufferSize.y * backgroundScale),
      );
      backgroundRenderTarget.setSize(
        backgroundWidth,
        backgroundHeight,
      );
      (
        backgroundUniforms.uBackgroundResolution
          .value as THREE.Vector2
      ).set(backgroundWidth, backgroundHeight);
      backgroundNeedsRender = true;
      backgroundUniforms.uBackgroundMotion.value =
        prefersReducedMotion ? 0 : width < 780 ? 0.62 : 1;
      camera.aspect = width / Math.max(height, 1);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const halfVerticalTangent = Math.tan(verticalFov / 2);
      if (usesPortraitCloth) {
        const horizontalFov = 2 * Math.atan(
          halfVerticalTangent * camera.aspect,
        );
        const fitHeightDistance =
          (
            clothLayout.height *
            uniforms.uFlagSize.value *
            1.18
          ) /
          (2 * halfVerticalTangent);
        const fitWidthDistance =
          (
            clothLayout.width *
            uniforms.uFlagSize.value *
            1.18
          ) /
          (2 * Math.tan(horizontalFov / 2));
        camera.position.z = Math.max(
          7.4,
          fitHeightDistance,
          fitWidthDistance,
        );
      } else {
        const portraitFitDistance =
          (
            clothLayout.width *
            uniforms.uFlagSize.value *
            1.1
          ) /
          (
            2 *
            halfVerticalTangent *
            camera.aspect
          );
        camera.position.z =
          camera.aspect < 0.8
            ? Math.max(7.4, portraitFitDistance)
            : width < 680
              ? 7.4
              : 6.6;
      }
      camera.updateProjectionMatrix();
    };
    resizeStageRef.current = resize;

    const setRayFromClient = (clientX: number, clientY: number) => {
      const bounds = canvas.getBoundingClientRect();
      tapPointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      tapRaycaster.setFromCamera(tapPointer, camera);
    };
    const getVisualFlagScale = () =>
      uniforms.uFlagSize.value * uniforms.uTransitionScale.value;
    const intersectFlag = (clientX: number, clientY: number) => {
      setRayFromClient(clientX, clientY);
      geometry.computeBoundingSphere();
      const visualScale = getVisualFlagScale();
      frontSurface.scale.setScalar(visualScale);
      backSurface.scale.setScalar(visualScale);
      frontSurface.updateMatrixWorld();
      backSurface.updateMatrixWorld();
      const intersection = tapRaycaster.intersectObjects(
        [frontSurface, backSurface],
        false,
      )[0];
      frontSurface.scale.setScalar(1);
      backSurface.scale.setScalar(1);
      frontSurface.updateMatrixWorld();
      backSurface.updateMatrixWorld();
      return { intersection, visualScale };
    };

    const handlePointer = (event: PointerEvent) => {
      if (
        tapStart.grabbed &&
        tapStart.pointerId === event.pointerId
      ) {
        const movement = Math.hypot(
          event.clientX - tapStart.x,
          event.clientY - tapStart.y,
        );
        const activationDistance =
          grabSettingsRef.current.activationDistance;
        if (movement < activationDistance) {
          event.preventDefault();
          return;
        }
        canvas.classList.add("is-grabbing");
        setRayFromClient(event.clientX, event.clientY);
        if (tapRaycaster.ray.intersectPlane(dragPlane, dragWorldPoint)) {
          const visualScale = Math.max(getVisualFlagScale(), 0.001);
          const localPoint = flag
            .worldToLocal(dragWorldPoint.clone())
            .divideScalar(visualScale);
          clothGrabRef.current.move(
            localPoint.x,
            localPoint.y,
            localPoint.z,
          );
        }
        event.preventDefault();
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      pointerTarget.x =
        ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      pointerTarget.y =
        ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    };
    const handlePointerLeave = () => {
      if (!tapStart.grabbed) pointerTarget.set(0, 0);
    };
    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      const { intersection, visualScale } = intersectFlag(
        event.clientX,
        event.clientY,
      );
      tapStart.pointerId = event.pointerId;
      tapStart.x = event.clientX;
      tapStart.y = event.clientY;
      tapStart.grabbed = false;
      delete canvas.dataset.autoReleased;
      const bounds = canvas.getBoundingClientRect();
      tapStart.screenX = THREE.MathUtils.clamp(
        (event.clientX - bounds.left) / Math.max(bounds.width, 1),
        0,
        1,
      );
      tapStart.screenY = THREE.MathUtils.clamp(
        (event.clientY - bounds.top) / Math.max(bounds.height, 1),
        0,
        1,
      );
      if (!intersection?.uv) return;

      tapStart.u = intersection.uv.x;
      tapStart.v = intersection.uv.y;
      const localPoint = flag
        .worldToLocal(intersection.point.clone())
        .divideScalar(Math.max(visualScale, 0.001));
      tapStart.grabbed = clothGrabRef.current.begin(
        tapStart.u,
        tapStart.v,
        localPoint.x,
        localPoint.y,
        localPoint.z,
      );
      if (!tapStart.grabbed) return;

      camera.getWorldDirection(dragPlaneNormal);
      dragPlane.setFromNormalAndCoplanarPoint(
        dragPlaneNormal,
        intersection.point,
      );
      pointerTarget.copy(pointer);
      canvas.classList.add("is-grab-ready");
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const handleCanvasPointerUp = (event: PointerEvent) => {
      if (tapStart.pointerId !== event.pointerId) return;
      const movement = Math.hypot(
        event.clientX - tapStart.x,
        event.clientY - tapStart.y,
      );
      const wasGrabbed = tapStart.grabbed;
      const origin = {
        x: tapStart.u,
        y: tapStart.v,
        screenX: tapStart.screenX,
        screenY: tapStart.screenY,
      };
      tapStart.pointerId = null;
      tapStart.grabbed = false;
      clothGrabRef.current.end();
      canvas.classList.remove("is-grab-ready", "is-grabbing");
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (!wasGrabbed) return;

      if (
        movement < grabSettingsRef.current.activationDistance
      ) {
        clothPokeRef.current(
          origin.x,
          origin.y,
        );
        clothAudioRef.current.impact = Math.max(
          clothAudioRef.current.impact,
          0.92,
        );
        advanceDesignRef.current(origin);
      } else {
        clothAudioRef.current.impact = Math.max(
          clothAudioRef.current.impact,
          0.68,
        );
      }
    };
    const handleCanvasPointerCancel = (event: PointerEvent) => {
      if (tapStart.pointerId === event.pointerId) {
        tapStart.pointerId = null;
        tapStart.grabbed = false;
        clothGrabRef.current.end();
        canvas.classList.remove("is-grab-ready", "is-grabbing");
      }
    };

    const render = (timestamp?: number) => {
      animationFrame = window.requestAnimationFrame(render);
      timer.update(timestamp);
      const rawDelta = timer.getDelta();
      const delta = Math.min(rawDelta, 0.05);
      fpsFrames += 1;
      fpsElapsed += rawDelta;
      if (fpsElapsed >= 0.75) {
        const measuredFps = fpsFrames / fpsElapsed;
        if (fpsRef.current) {
          fpsRef.current.textContent = `${Math.round(measuredFps)} FPS`;
        }
        if (measuredFps < 50) {
          lowFpsIntervals += 1;
          highFpsIntervals = 0;
          if (lowFpsIntervals >= 2 && renderScale > 0.76) {
            renderScale = Math.max(0.75, renderScale - 0.1);
            lowFpsIntervals = 0;
            resize();
          }
        } else if (measuredFps > 58 && renderScale < 0.99) {
          highFpsIntervals += 1;
          lowFpsIntervals = 0;
          if (highFpsIntervals >= 4) {
            renderScale = Math.min(1, renderScale + 0.05);
            highFpsIntervals = 0;
            resize();
          }
        } else {
          lowFpsIntervals = 0;
          highFpsIntervals = 0;
        }
        fpsFrames = 0;
        fpsElapsed = 0;
      }
      if (!pauseRef.current) {
        uniforms.uTime.value += delta;
        const safeSpeed = THREE.MathUtils.clamp(windRef.current.speed, 0.01, 300);
        simulationTime = (simulationTime + delta * safeSpeed) % 10000;
        const clothMetrics = clothSimulation.step(
          delta,
          windRef.current,
          simulationTime,
          transitionGustRef.current,
        );
        if (clothMetrics.releasedGrab && tapStart.grabbed) {
          const releasedPointerId = tapStart.pointerId;
          tapStart.pointerId = null;
          tapStart.grabbed = false;
          canvas.dataset.autoReleased = "collision";
          canvas.classList.remove(
            "is-grab-ready",
            "is-grabbing",
          );
          if (
            releasedPointerId !== null &&
            canvas.hasPointerCapture(releasedPointerId)
          ) {
            canvas.releasePointerCapture(releasedPointerId);
          }
        }
        clothAudioRef.current = {
          motion: clothMetrics.motion,
          impact: Math.max(
            clothMetrics.impact,
            clothMetrics.releasedGrab ? 0.36 : 0,
            clothAudioRef.current.impact * 0.92,
          ),
        };
        activeClothEdge.update();
      } else {
        clothAudioRef.current = { motion: 0, impact: 0 };
      }

      pointer.lerp(pointerTarget, 0.045);
      const baseFlagRotationY = usesPortraitCloth ? -0.08 : -0.12;
      flag.rotation.y = THREE.MathUtils.lerp(
        flag.rotation.y,
        baseFlagRotationY + pointer.x * 0.08,
        0.04,
      );
      flag.rotation.x = THREE.MathUtils.lerp(flag.rotation.x, -0.025 - pointer.y * 0.045, 0.04);
      backgroundUniforms.uBackgroundTime.value =
        uniforms.uTime.value;
      (
        backgroundUniforms.uBackgroundPointer.value as THREE.Vector2
      ).copy(pointer);
      backgroundRenderFrame += 1;
      if (
        backgroundNeedsRender ||
        backgroundRenderFrame % 2 === 0
      ) {
        renderer.setRenderTarget(backgroundRenderTarget);
        renderer.clear(true, true, true);
        renderer.render(backgroundScene, backgroundCamera);
        renderer.setRenderTarget(null);
        backgroundNeedsRender = false;
      }
      renderer.clear(true, true, true);
      renderer.render(
        backgroundCompositeScene,
        backgroundCamera,
      );
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (!hasRendered) {
        hasRendered = true;
        completeLoading();
      }
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    const canvasParent = canvas.parentElement;
    if (canvasParent) resizeObserver.observe(canvasParent);
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointermove", handlePointer);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointerdown", handleCanvasPointerDown);
    canvas.addEventListener("pointerup", handleCanvasPointerUp);
    canvas.addEventListener("pointercancel", handleCanvasPointerCancel);
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(designTransitionFrame);
      window.cancelAnimationFrame(backgroundTransitionFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", handlePointer);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
      canvas.removeEventListener("pointerup", handleCanvasPointerUp);
      canvas.removeEventListener(
        "pointercancel",
        handleCanvasPointerCancel,
      );
      clothSimulation.releaseGrab();
      canvas.classList.remove("is-grab-ready", "is-grabbing");
      geometry.dispose();
      intactClothEdge.geometry.dispose();
      tornClothEdge.geometry.dispose();
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      backgroundGeometry.dispose();
      backgroundMaterial.dispose();
      backgroundCompositeGeometry.dispose();
      backgroundCompositeMaterial.dispose();
      backgroundRenderTarget.dispose();
      artworkTexture.dispose();
      previousArtworkTexture.dispose();
      renderer.dispose();
      timer.dispose();
      designLoadRef.current += 1;
      uniformsRef.current = null;
      textureRef.current = null;
      designTransitionRef.current = () => undefined;
      backgroundTransitionRef.current = () => undefined;
      backgroundParametersRef.current = () => undefined;
      transitionGustRef.current = 0;
      clothPokeRef.current = () => undefined;
      clothGrabRef.current = {
        begin: () => false,
        move: () => undefined,
        end: () => undefined,
        configure: () => undefined,
      };
      tearModeUpdaterRef.current = () => undefined;
      simulationResetRef.current = () => undefined;
      resizeStageRef.current = () => undefined;
    };
  }, [meshQuality, usesPortraitCloth]);

  useEffect(() => {
    windRef.current = wind;
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uStrength.value = wind.strength;
    uniforms.uTurbulence.value = wind.turbulence;
    uniforms.uDirection.value = wind.direction;
    uniforms.uSpeed.value = wind.speed;
    uniforms.uGravity.value = wind.gravity;
    uniforms.uGustiness.value = wind.gustiness;
  }, [wind]);

  useEffect(() => {
    return () => {
      const engine = windAudioRef.current;
      if (!engine) return;
      window.clearInterval(engine.updateTimer);
      engine.source.stop();
      void engine.context.close();
      windAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uFlagSize.value = flagSize;
      resizeStageRef.current();
    }
  }, [flagSize]);

  useEffect(() => {
    uniformsRef.current?.uColor.value.set(color);
  }, [color]);

  useEffect(() => {
    transitionModeRef.current = transitionMode;
    const uniforms = uniformsRef.current;
    if (uniforms) {
      uniforms.uTransitionMode.value =
        getTransitionModeValue(transitionMode);
    }
  }, [transitionMode]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uFabricPreset.value = materialSettings.preset;
    uniforms.uTextureScale.value = materialSettings.scale;
    uniforms.uThickness.value = materialSettings.thickness;
    uniforms.uNormalStrength.value = materialSettings.normalStrength;
    uniforms.uBumpStrength.value = materialSettings.bumpStrength;
    uniforms.uRoughness.value = materialSettings.roughness;
  }, [materialSettings]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uAmbientIntensity.value = lighting.ambient;
    uniforms.uKeyIntensity.value = lighting.keyIntensity;
    uniforms.uLightX.value = lighting.horizontal;
    uniforms.uLightY.value = lighting.vertical;
    uniforms.uLightZ.value = lighting.depth;
    uniforms.uRimIntensity.value = lighting.rimIntensity;
    uniforms.uLightColor.value.set(lighting.color);
    uniforms.uPremiereIntensity.value = lighting.premiereIntensity;
    uniforms.uPremiereSpeed.value = lighting.premiereSpeed;
  }, [lighting]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uPremiereActive.value =
      activeDesign === "popcorn" && premiereLightsEnabled ? 1 : 0;
  }, [activeDesign, premiereLightsEnabled]);

  useEffect(() => {
    artworkScaleRef.current = artworkScale;
    const artworkCanvas = artworkCanvasRef.current;
    const artworkImage = artworkImageRef.current;
    const texture = textureRef.current;
    if (!artworkCanvas || !artworkImage || !texture) return;
    drawArtworkImage(artworkCanvas, artworkImage, artworkScale);
    texture.needsUpdate = true;
  }, [artworkScale]);

  useEffect(() => {
    tearModeUpdaterRef.current(tornMode);
  }, [meshQuality, tornMode, usesPortraitCloth]);

  useEffect(() => {
    grabSettingsRef.current = grabSettings;
    clothGrabRef.current.configure(grabSettings);
  }, [grabSettings]);

  const updateWind =
    (key: keyof WindControls) => (value: number) => {
      setWind((current) => ({
        ...current,
        [key]: value,
      }));
    };

  const updateMaterial =
    (key: Exclude<keyof MaterialControls, "preset">) =>
    (value: number) => {
      setMaterialSettings((current) => ({
        ...current,
        [key]: value,
      }));
    };

  const updateGrab =
    (key: keyof GrabControls) => (value: number) => {
      setGrabSettings((current) => ({
        ...current,
        [key]: value,
      }));
    };

  const updateBackground = (
    key: keyof BackgroundControls,
    value: number,
  ) => {
    const nextSettings = {
      ...backgroundSettings,
      [key]: value,
    };
    const settingsKey = activeDesign ?? "custom";
    backgroundSettingsByDesignRef.current[settingsKey] =
      nextSettings;
    backgroundParametersRef.current(nextSettings);
    setBackgroundSettings(nextSettings);
  };

  const updateLighting =
    (key: Exclude<keyof LightingControls, "color">) =>
    (value: number) => {
      setLighting((current) => ({
        ...current,
        [key]: value,
      }));
    };

  const togglePause = () => {
    pauseRef.current = !paused;
    setPaused(!paused);
  };

  const createWindAudio = () => {
    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    const context = new AudioContextConstructor();
    const bufferLength = Math.floor(context.sampleRate * 8);
    const noiseBuffer = context.createBuffer(2, bufferLength, context.sampleRate);

    for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel += 1) {
      const samples = noiseBuffer.getChannelData(channel);
      let softenedNoise = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const whiteNoise = Math.random() * 2 - 1;
        softenedNoise = (softenedNoise + whiteNoise * 0.025) / 1.025;
        samples[index] = softenedNoise * 3.2 + whiteNoise * 0.12;
      }
    }

    const impactDuration = 0.12;
    const impactBuffer = context.createBuffer(
      2,
      Math.floor(context.sampleRate * impactDuration),
      context.sampleRate,
    );
    for (
      let channel = 0;
      channel < impactBuffer.numberOfChannels;
      channel += 1
    ) {
      const samples = impactBuffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        const time = index / context.sampleRate;
        const attack = Math.min(time * 900, 1);
        const bodyEnvelope =
          (Math.exp(-time * 82) * 0.86 + Math.exp(-time * 30) * 0.14) *
          attack;
        const snapEnvelope = Math.exp(-time * 115) * attack;
        const clothNoise = Math.random() * 2 - 1;
        const lowSnap = Math.sin(
          Math.PI * 2 * (72 * time - 60 * time * time),
        );
        const subBody = Math.sin(Math.PI * 2 * 48 * time);
        samples[index] =
          lowSnap * bodyEnvelope * 0.78 +
          subBody * bodyEnvelope * 0.18 +
          clothNoise * snapEnvelope * 0.04;
      }
    }

    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 620;
    bodyFilter.Q.value = 0.45;

    const detailFilter = context.createBiquadFilter();
    detailFilter.type = "bandpass";
    detailFilter.frequency.value = 1450;
    detailFilter.Q.value = 0.75;

    const gustFilter = context.createBiquadFilter();
    gustFilter.type = "bandpass";
    gustFilter.frequency.value = 780;
    gustFilter.Q.value = 1.8;

    const clothFilter = context.createBiquadFilter();
    clothFilter.type = "highpass";
    clothFilter.frequency.value = 2400;
    clothFilter.Q.value = 0.55;

    const bodyGain = context.createGain();
    const detailGain = context.createGain();
    const gustGain = context.createGain();
    const clothGain = context.createGain();
    const masterGain = context.createGain();
    const panner = context.createStereoPanner();
    const compressor = context.createDynamicsCompressor();
    bodyGain.gain.value = 0;
    detailGain.gain.value = 0;
    gustGain.gain.value = 0;
    clothGain.gain.value = 0;
    masterGain.gain.value = 0;
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;

    source.connect(bodyFilter).connect(bodyGain).connect(masterGain);
    source.connect(detailFilter).connect(detailGain).connect(masterGain);
    source.connect(gustFilter).connect(gustGain).connect(masterGain);
    source.connect(clothFilter).connect(clothGain).connect(masterGain);
    masterGain.connect(panner).connect(compressor).connect(context.destination);
    source.start();

    const engine: WindAudioEngine = {
      context,
      source,
      bodyFilter,
      detailFilter,
      gustFilter,
      clothFilter,
      bodyGain,
      detailGain,
      gustGain,
      clothGain,
      masterGain,
      panner,
      impactBuffer,
      lastImpactAt: Number.NEGATIVE_INFINITY,
      nextImpactAt: context.currentTime + 0.22,
      updateTimer: 0,
      startedAt: performance.now() / 1000,
    };

    engine.updateTimer = window.setInterval(() => {
      const now = context.currentTime;
      const elapsed = performance.now() / 1000 - engine.startedAt;
      const currentWind = windRef.current;
      const strength = 1 - Math.exp(-Math.max(currentWind.strength, 0) / 4.5);
      const speed = THREE.MathUtils.clamp(
        Math.log2(1 + Math.max(currentWind.speed, 0)) / Math.log2(13),
        0,
        1,
      );
      const turbulence = THREE.MathUtils.clamp(
        currentWind.turbulence / 8,
        0,
        1,
      );
      const gustiness = THREE.MathUtils.clamp(
        currentWind.gustiness / 3,
        0,
        1,
      );
      const sound = windSoundRef.current;
      const cloth = clothAudioRef.current;
      const slowDrift =
        Math.sin(elapsed * (0.19 + speed * 0.24) + 0.4) * 0.5 + 0.5;
      const mediumDrift =
        Math.sin(elapsed * (0.61 + speed * 0.83) + 2.1) * 0.5 + 0.5;
      const fineDrift =
        Math.sin(elapsed * (1.73 + turbulence * 2.1) + 1.2) * 0.5 + 0.5;
      const irregularity = Math.random();
      const gustActivity = THREE.MathUtils.clamp(
        slowDrift * 0.28 +
          mediumDrift * 0.29 +
          fineDrift * 0.16 +
          irregularity * 0.27,
        0,
        1,
      );
      const gustPulse = Math.pow(gustActivity, 2.35);
      const gustWave =
        (mediumDrift - 0.5) * 0.42 +
        (fineDrift - 0.5) * 0.2 +
        (irregularity - 0.5) * 0.18;
      const gustEnvelope = THREE.MathUtils.clamp(
        0.86 + gustiness * sound.gustDepth * gustWave,
        0.52,
        1.42,
      );
      const muted = pauseRef.current || document.hidden;
      const audibleWind =
        muted || !windLayerEnabledRef.current ? 0 : sound.volume;
      const audibleCloth =
        muted || !clothLayerEnabledRef.current ? 0 : sound.clothVolume;
      const bodyLevel =
        audibleWind *
        sound.body *
        strength *
        (0.026 + speed * 0.052) *
        gustEnvelope;
      const detailLevel =
        audibleWind *
        sound.air *
        strength *
        (0.003 + turbulence * 0.04) *
        (0.72 + gustiness * gustPulse * 0.55);
      const gustLevel =
        audibleWind *
        sound.gustDepth *
        strength *
        gustiness *
        (0.004 + turbulence * 0.024 + speed * 0.012) *
        gustPulse;
      const clothLevel =
        audibleCloth *
        sound.clothRustle *
        cloth.motion *
        (0.002 + turbulence * 0.013 + speed * 0.004);

      bodyGain.gain.setTargetAtTime(bodyLevel, now, 0.09);
      detailGain.gain.setTargetAtTime(detailLevel, now, 0.055);
      gustGain.gain.setTargetAtTime(gustLevel, now, 0.075);
      clothGain.gain.setTargetAtTime(clothLevel, now, 0.045);
      bodyFilter.frequency.setTargetAtTime(
        260 + speed * 720 + turbulence * 360,
        now,
        0.12,
      );
      bodyFilter.Q.setTargetAtTime(0.35 + turbulence * 0.55, now, 0.12);
      detailFilter.frequency.setTargetAtTime(
        850 + speed * 1550 + turbulence * 1150,
        now,
        0.085,
      );
      detailFilter.Q.setTargetAtTime(0.58 + gustiness * 0.7, now, 0.1);
      gustFilter.frequency.setTargetAtTime(
        430 +
          speed * 860 +
          turbulence * 380 +
          (slowDrift - 0.5) * 310,
        now,
        0.11,
      );
      gustFilter.Q.setTargetAtTime(
        1.1 + gustiness * 2.2 + gustPulse * 1.1,
        now,
        0.1,
      );
      clothFilter.frequency.setTargetAtTime(
        1850 + cloth.motion * 2200 + turbulence * 1350,
        now,
        0.06,
      );
      clothFilter.Q.setTargetAtTime(
        0.42 + cloth.motion * 0.55,
        now,
        0.08,
      );

      if (
        audibleCloth > 0.001 &&
        sound.clothImpact > 0.001 &&
        now >= engine.nextImpactAt
      ) {
        const impactStrength = THREE.MathUtils.clamp(
          (0.34 +
            Math.random() * 0.48 +
            cloth.impact * 0.1 +
            cloth.motion * 0.08) *
            sound.clothImpact *
            audibleCloth,
          0,
          1,
        );
        const impactSource = context.createBufferSource();
        const impactBodyFilter = context.createBiquadFilter();
        const impactSnapFilter = context.createBiquadFilter();
        const impactBodyGain = context.createGain();
        const impactSnapGain = context.createGain();
        const clothWeight = THREE.MathUtils.clamp(
          sound.clothWeight,
          0,
          1,
        );
        impactSource.buffer = engine.impactBuffer;
        impactSource.playbackRate.value = 0.86 + Math.random() * 0.24;
        impactBodyFilter.type = "lowpass";
        impactBodyFilter.frequency.value =
          155 + (1 - clothWeight) * 230 + cloth.motion * 65;
        impactBodyFilter.Q.value = 1.05 + clothWeight * 0.9;
        impactSnapFilter.type = "bandpass";
        impactSnapFilter.frequency.value =
          720 + (1 - clothWeight) * 1150 + Math.random() * 320;
        impactSnapFilter.Q.value = 0.9 + turbulence * 0.2;
        impactBodyGain.gain.setValueAtTime(0.0001, now);
        impactBodyGain.gain.linearRampToValueAtTime(
          0.06 + impactStrength * 0.24,
          now + 0.0025,
        );
        impactBodyGain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.075,
        );
        impactSnapGain.gain.setValueAtTime(0.0001, now);
        impactSnapGain.gain.linearRampToValueAtTime(
          0.0008 +
            impactStrength * 0.006 * (1 - clothWeight * 0.55),
          now + 0.0015,
        );
        impactSnapGain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.026,
        );
        impactSource
          .connect(impactBodyFilter)
          .connect(impactBodyGain)
          .connect(masterGain);
        impactSource
          .connect(impactSnapFilter)
          .connect(impactSnapGain)
          .connect(masterGain);
        impactSource.start(now);
        impactSource.stop(now + 0.12);
        engine.lastImpactAt = now;
        engine.nextImpactAt = now + 0.24 + Math.random() * 0.38;
      }
      clothAudioRef.current.impact *= 0.22;
      panner.pan.setTargetAtTime(
        Math.sin(elapsed * 0.23 + mediumDrift) * gustiness * 0.12,
        now,
        0.18,
      );
    }, 50);

    windAudioRef.current = engine;
    return engine;
  };

  const syncAudioLayers = async (
    windEnabled: boolean,
    clothEnabled: boolean,
  ) => {
    const anyLayerEnabled = windEnabled || clothEnabled;
    const engine =
      windAudioRef.current ??
      (anyLayerEnabled ? createWindAudio() : null);
    if (anyLayerEnabled && !engine) return false;
    if (engine) {
      if (anyLayerEnabled && engine.context.state !== "running") {
        await engine.context.resume();
      }
      const now = engine.context.currentTime;
      engine.masterGain.gain.cancelScheduledValues(now);
      engine.masterGain.gain.setTargetAtTime(
        anyLayerEnabled ? 0.9 : 0,
        now,
        0.08,
      );
    }
    return true;
  };

  const toggleWindSound = async () => {
    const nextEnabled = !windLayerEnabledRef.current;
    windLayerEnabledRef.current = nextEnabled;
    const ready = await syncAudioLayers(
      nextEnabled,
      clothLayerEnabledRef.current,
    );
    if (!ready) {
      windLayerEnabledRef.current = false;
      return;
    }
    setWindSoundEnabled(nextEnabled);
  };

  const toggleClothSound = async () => {
    const nextEnabled = !clothLayerEnabledRef.current;
    clothLayerEnabledRef.current = nextEnabled;
    const ready = await syncAudioLayers(
      windLayerEnabledRef.current,
      nextEnabled,
    );
    if (!ready) {
      clothLayerEnabledRef.current = false;
      return;
    }
    setClothSoundEnabled(nextEnabled);
  };

  const updateWindSound = (
    key: keyof WindSoundControls,
    value: number,
  ) => {
    setWindSound((currentSound) => {
      const nextSound = { ...currentSound, [key]: value };
      windSoundRef.current = nextSound;
      return nextSound;
    });
  };

  const updateArtworkScale = (value: number) => {
    artworkScaleRef.current = value;
    setArtworkScale(value);
    if (activeDesign) {
      designArtworkScalesRef.current[activeDesign] = value;
    }
  };

  const animateNavigationPress = () => {
    const switcher = designSwitcherRef.current;
    if (
      !switcher ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    navigationPressAnimationRef.current?.cancel();
    const baseScale = switcher.matches(":hover") ? 1.05 : 1;
    const animation = switcher.animate(
      [
        { transform: `scale(${baseScale})`, offset: 0 },
        { transform: `scale(${baseScale * 0.97})`, offset: 0.38 },
        { transform: `scale(${baseScale * 1.006})`, offset: 0.7 },
        { transform: `scale(${baseScale})`, offset: 1 },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
    navigationPressAnimationRef.current = animation;
    animation.onfinish = () => {
      if (navigationPressAnimationRef.current === animation) {
        navigationPressAnimationRef.current = null;
      }
    };
  };

  const animateSelectedIdentityTap = (tapTime: number) => {
    const switcher = designSwitcherRef.current;
    const character = switcher?.querySelector<HTMLElement>(
      ".design-tab.is-active .identity-character-selected",
    );
    if (
      !switcher ||
      !character ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const previousStreak = identityTapStreakRef.current;
    const count =
      tapTime - previousStreak.lastTap < 720
        ? Math.min(previousStreak.count + 1, 5)
        : 1;
    identityTapStreakRef.current = {
      count,
      lastTap: tapTime,
    };

    for (const animation of identityTapAnimationsRef.current) {
      animation.cancel();
    }

    const feelsHit = count >= 3;
    const direction = count % 2 === 0 ? 1 : -1;
    const hitDistance = 3.5 + (count - 3) * 1.1;
    const hitRotation = 6 + (count - 3) * 1.4;
    const characterAnimation = character.animate(
      feelsHit
        ? [
            {
              transform:
                "translate(-50%, -50%) rotate(0deg) scale(1)",
              offset: 0,
            },
            {
              transform: `translate(calc(-50% + ${direction * 1.4}px), -48%) rotate(${direction * 2}deg) scale(0.97, 1.03)`,
              offset: 0.14,
            },
            {
              transform: `translate(calc(-50% + ${direction * hitDistance}px), -50%) rotate(${direction * hitRotation}deg) scale(0.9, 1.07)`,
              offset: 0.3,
            },
            {
              transform: `translate(calc(-50% - ${direction * 1.4}px), -50%) rotate(${-direction * 2.6}deg) scale(1.035, 0.975)`,
              offset: 0.58,
            },
            {
              transform: `translate(calc(-50% + ${direction * 0.45}px), -50%) rotate(${direction * 0.8}deg) scale(0.99, 1.01)`,
              offset: 0.8,
            },
            {
              transform:
                "translate(-50%, -50%) rotate(0deg) scale(1)",
              offset: 1,
            },
          ]
        : [
            {
              transform:
                "translate(-50%, -50%) rotate(0deg) scale(1)",
              offset: 0,
            },
            {
              transform: `translate(calc(-50% + ${direction * 0.8}px), -62%) rotate(${direction * 3.4}deg) scale(0.96, 1.065)`,
              offset: 0.3,
            },
            {
              transform: `translate(calc(-50% - ${direction * 0.45}px), -48%) rotate(${-direction * 2.2}deg) scale(1.045, 0.955)`,
              offset: 0.58,
            },
            {
              transform: `translate(-50%, -52%) rotate(${direction * 0.7}deg) scale(0.99, 1.015)`,
              offset: 0.78,
            },
            {
              transform:
                "translate(-50%, -50%) rotate(0deg) scale(1)",
              offset: 1,
            },
          ],
      {
        duration: feelsHit ? 430 : 560,
        easing: "linear",
      },
    );

    const eyeAnimations = Array.from(
      character.querySelectorAll<HTMLElement>(".identity-eyes > span"),
    ).map((eye, eyeIndex) => {
      const isWinkingEye =
        count === 2 && eyeIndex === (direction > 0 ? 0 : 1);
      return eye.animate(
        feelsHit
          ? [
              {
                transform: "translateX(0) scale(1)",
                offset: 0,
              },
              {
                transform: `translateX(${-direction * 0.3}px) scale(1.12, 0.76)`,
                offset: 0.12,
              },
              {
                transform: `translateX(${-direction * 0.8}px) scale(1.62, 0.12)`,
                offset: 0.24,
              },
              {
                transform: `translateX(${-direction * 0.65}px) scale(1.5, 0.14)`,
                offset: 0.54,
              },
              {
                transform: "translateY(-0.45px) scale(1.2, 1.34)",
                offset: 0.74,
              },
              {
                transform: "translateX(0) scale(1)",
                offset: 1,
              },
            ]
          : [
              {
                transform: "translateY(0) scale(1)",
                offset: 0,
              },
              {
                transform: "translateY(0.25px) scale(0.84)",
                offset: 0.16,
              },
              {
                transform: isWinkingEye
                  ? "translateY(0.35px) scale(1.5, 0.12)"
                  : "translateY(-0.9px) scale(1.78)",
                offset: 0.34,
              },
              {
                transform: isWinkingEye
                  ? "translateY(0.2px) scale(1.34, 0.18)"
                  : "translateY(-0.35px) scale(1.34)",
                offset: 0.58,
              },
              {
                transform: "translateY(0) scale(0.94, 1.12)",
                offset: 0.78,
              },
              {
                transform: "translateY(0) scale(1)",
                offset: 1,
              },
            ],
        {
          duration: feelsHit ? 430 : 520,
          easing: "linear",
        },
      );
    });

    identityTapAnimationsRef.current = [
      characterAnimation,
      ...eyeAnimations,
    ];
    switcher.dataset.identityReaction = feelsHit ? "hit" : "play";
    switcher.dataset.identityTapStreak = String(count);
    if (identityTapTimerRef.current !== null) {
      window.clearTimeout(identityTapTimerRef.current);
    }
    identityTapTimerRef.current = window.setTimeout(() => {
      delete switcher.dataset.identityReaction;
      delete switcher.dataset.identityTapStreak;
      identityTapTimerRef.current = null;
    }, feelsHit ? 430 : 560);
  };

  const applyDesign = (
    design: DesignPreset,
    transitionOrigin: TransitionOrigin = DEFAULT_TRANSITION_ORIGIN,
  ) => {
    const sourceDesignId = activeDesignRef.current;
    if (sourceDesignId === design.id) return;

    const designScale =
      designArtworkScalesRef.current[design.id] ?? INITIAL_ARTWORK_SCALE;
    artworkScaleRef.current = designScale;
    setArtworkScale(designScale);

    const artworkCanvas = artworkCanvasRef.current;
    const texture = textureRef.current;
    if (!artworkCanvas || !texture) return;

    const sourceIndex = DESIGN_PRESETS.findIndex(
      (preset) => preset.id === sourceDesignId,
    );
    const targetIndex = DESIGN_PRESETS.findIndex(
      (preset) => preset.id === design.id,
    );
    const transitionDirection =
      sourceIndex < 0 || targetIndex >= sourceIndex ? 1 : -1;
    const loadToken = ++designLoadRef.current;
    const cachedImage = designImageCache.get(design.asset);
    const image =
      cachedImage?.complete && cachedImage.naturalWidth === 0
        ? new Image()
        : cachedImage ?? new Image();
    if (!image.complete || image.naturalWidth === 0) {
      setIsLoading(true);
    }
    image.onload = () => {
      if (designLoadRef.current !== loadToken) return;
      designImageCache.set(design.asset, image);
      artworkImageRef.current = image;
      if (sourceDesignId && sourceDesignId !== design.id) {
        setPreviousDesign(sourceDesignId);
      } else {
        setPreviousDesign(null);
      }
      if (previousDesignTimerRef.current !== null) {
        window.clearTimeout(previousDesignTimerRef.current);
      }
      previousDesignTimerRef.current = window.setTimeout(() => {
        setPreviousDesign(null);
        previousDesignTimerRef.current = null;
      }, 880);
      activeDesignRef.current = design.id;
      setActiveDesign(design.id);
      setColor(design.color);
      setArtworkName(design.label);
      designTransitionRef.current(
        image,
        design.color,
        artworkScaleRef.current,
        transitionDirection,
        transitionOrigin,
      );
      window.requestAnimationFrame(() => setIsLoading(false));
    };
    image.onerror = () => {
      if (designLoadRef.current === loadToken) setIsLoading(false);
    };
    if (image.complete && image.naturalWidth > 0) {
      image.onload?.(new Event("load"));
    } else if (!image.src) {
      image.src = design.asset;
    }
  };

  const navigateDesign = (
    offset: number,
    origin: TransitionOrigin = DEFAULT_TRANSITION_ORIGIN,
  ) => {
    const currentIndex = DESIGN_PRESETS.findIndex(
      (design) => design.id === activeDesignRef.current,
    );
    const nextIndex = currentIndex < 0
      ? offset >= 0
        ? 0
        : DESIGN_PRESETS.length - 1
      : (
          currentIndex +
          offset +
          DESIGN_PRESETS.length
        ) % DESIGN_PRESETS.length;
    applyDesign(DESIGN_PRESETS[nextIndex], origin);
  };

  const advanceDesign = (origin?: TransitionOrigin) => {
    navigateDesign(1, origin ?? DEFAULT_TRANSITION_ORIGIN);
  };

  useEffect(() => {
    navigateDesignRef.current = (offset) => {
      navigateDesign(offset);
    };
    advanceDesignRef.current = advanceDesign;
  });

  const applyDesignAtPointer = (clientX: number) => {
    const switcher = designSwitcherRef.current;
    if (!switcher) return;

    const buttons = Array.from(
      switcher.querySelectorAll<HTMLButtonElement>("[data-design-id]"),
    );
    let closestButton: HTMLButtonElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const button of buttons) {
      const bounds = button.getBoundingClientRect();
      const distance = Math.abs(clientX - (bounds.left + bounds.right) / 2);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestButton = button;
      }
    }

    const designId = closestButton?.dataset.designId;
    if (
      !designId ||
      navigationDragRef.current.lastDesignId === designId
    ) {
      return;
    }

    const design = DESIGN_PRESETS.find((preset) => preset.id === designId);
    if (!design) return;
    navigationDragRef.current.lastDesignId = designId;
    applyDesign(design);
  };

  const stopNavigationDrag = (suppressNextClick = false) => {
    navigationDragRef.current.pointerId = null;
    navigationDragRef.current.dragged = false;
    navigationDragRef.current.lastDesignId = null;
    setIsNavigationDragging(false);

    if (suppressNextClick) {
      suppressNavigationClickRef.current = true;
      window.setTimeout(() => {
        suppressNavigationClickRef.current = false;
      }, 0);
    }
  };

  const handleNavigationPointerDown = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    const designId = (
      event.target as HTMLElement
    ).closest<HTMLButtonElement>("[data-design-id]")?.dataset.designId;

    if (designId) {
      animateNavigationPress();
    }

    navigationDragRef.current.pointerId = event.pointerId;
    navigationDragRef.current.startX = event.clientX;
    navigationDragRef.current.dragged = false;
    navigationDragRef.current.lastDesignId = designId ?? null;
    suppressNavigationClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleNavigationPointerMove = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const drag = navigationDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (!drag.dragged && Math.abs(event.clientX - drag.startX) < 4) return;

    if (!drag.dragged) setIsNavigationDragging(true);
    drag.dragged = true;
    suppressNavigationClickRef.current = true;
    event.preventDefault();
    applyDesignAtPointer(event.clientX);
  };

  const handleNavigationPointerEnd = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const drag = navigationDragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const tappedDesignId = drag.dragged ? null : drag.lastDesignId;
    if (tappedDesignId) {
      const design = DESIGN_PRESETS.find(
        (preset) => preset.id === tappedDesignId,
      );
      if (design) {
        if (design.id === activeDesignRef.current) {
          animateSelectedIdentityTap(event.timeStamp);
        } else {
          applyDesign(design);
        }
      }
    }

    stopNavigationDrag(drag.dragged || Boolean(tappedDesignId));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleNavigationPointerCancel = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (navigationDragRef.current.pointerId !== event.pointerId) return;
    stopNavigationDrag(navigationDragRef.current.dragged);
  };

  const reset = () => {
    const selectedDesign =
      DESIGN_PRESETS.find((design) => design.id === activeDesign) ??
      INITIAL_DESIGN;
    designArtworkScalesRef.current[selectedDesign.id] =
      INITIAL_ARTWORK_SCALE;
    artworkScaleRef.current = INITIAL_ARTWORK_SCALE;
    setWind(INITIAL_WIND);
    setFlagSize(INITIAL_FLAG_SIZE);
    setArtworkScale(INITIAL_ARTWORK_SCALE);
    setMaterialSettings(INITIAL_MATERIAL);
    setGrabSettings(INITIAL_GRAB);
    setLighting(INITIAL_LIGHTING);
    const initialBackgroundSettings = getBackgroundControls(
      selectedDesign.background,
    );
    backgroundSettingsByDesignRef.current[selectedDesign.id] =
      initialBackgroundSettings;
    setBackgroundSettings(initialBackgroundSettings);
    backgroundParametersRef.current(initialBackgroundSettings);
    windSoundRef.current = INITIAL_WIND_SOUND;
    setWindSound(INITIAL_WIND_SOUND);
    setMeshQuality(INITIAL_MESH_QUALITY);
    transitionModeRef.current = INITIAL_TRANSITION_MODE;
    setTransitionMode(INITIAL_TRANSITION_MODE);
    setTornMode(false);
    setPremiereLightsEnabled(true);
    setColor(selectedDesign.color);
    pauseRef.current = false;
    clothAudioRef.current = { motion: 0, impact: 0 };
    setPaused(false);
    simulationResetRef.current();
    applyDesign(selectedDesign);
  };

  const handleArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const artworkCanvas = artworkCanvasRef.current;
    const texture = textureRef.current;
    if (!file || !artworkCanvas || !texture) return;
    if (
      !ALLOWED_ARTWORK_TYPES.has(file.type) ||
      file.size > MAX_ARTWORK_FILE_SIZE
    ) {
      setArtworkName("Usá PNG o WebP de hasta 10 MB");
      event.target.value = "";
      return;
    }

    const image = new Image();
    const fileUrl = URL.createObjectURL(file);
    setIsLoading(true);
    image.onload = () => {
      if (
        image.naturalWidth > MAX_ARTWORK_DIMENSION ||
        image.naturalHeight > MAX_ARTWORK_DIMENSION
      ) {
        URL.revokeObjectURL(fileUrl);
        setArtworkName("La imagen supera 8192 px");
        setIsLoading(false);
        return;
      }
      designLoadRef.current += 1;
      artworkImageRef.current = image;
      const sourceDesignId = activeDesignRef.current;
      if (sourceDesignId) {
        setPreviousDesign(sourceDesignId);
      }
      if (previousDesignTimerRef.current !== null) {
        window.clearTimeout(previousDesignTimerRef.current);
      }
      previousDesignTimerRef.current = window.setTimeout(() => {
        setPreviousDesign(null);
        previousDesignTimerRef.current = null;
      }, 880);
      designTransitionRef.current(
        image,
        color,
        artworkScaleRef.current,
        1,
        DEFAULT_TRANSITION_ORIGIN,
      );
      setArtworkName(file.name);
      activeDesignRef.current = null;
      setActiveDesign(null);
      URL.revokeObjectURL(fileUrl);
      window.requestAnimationFrame(() => setIsLoading(false));
    };
    image.onerror = () => {
      URL.revokeObjectURL(fileUrl);
      setIsLoading(false);
    };
    image.src = fileUrl;
    event.target.value = "";
  };

  return (
    <main
      className={`studio-shell ${
        controlsOpen ? "" : "controls-collapsed"
      }`}
    >
      <header className="topbar">
        <div ref={identityMotionRef} className="navigation-dock">
          <nav
            ref={designSwitcherRef}
            className={`design-switcher ${
              isNavigationDragging ? "is-dragging" : ""
            }`}
            aria-label="Diseños de bandera"
            onPointerDown={handleNavigationPointerDown}
            onPointerMove={handleNavigationPointerMove}
            onPointerUp={handleNavigationPointerEnd}
            onPointerCancel={handleNavigationPointerCancel}
            onLostPointerCapture={() => stopNavigationDrag()}
            onClickCapture={(event) => {
              if (!suppressNavigationClickRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressNavigationClickRef.current = false;
            }}
          >
            {DESIGN_PRESETS.map((design) => {
              const isActive = activeDesign === design.id;
              const isLeaving =
                previousDesign === design.id && !isActive;

              return (
                <button
                  key={design.id}
                  className={`design-tab ${
                    isActive
                      ? "is-active"
                      : isLeaving
                        ? "is-leaving"
                        : ""
                  }`}
                  type="button"
                  onClick={(event) => {
                    if (design.id === activeDesignRef.current) {
                      animateSelectedIdentityTap(event.timeStamp);
                    } else {
                      applyDesign(design);
                    }
                  }}
                  aria-label={design.label}
                  aria-pressed={isActive}
                  data-design-id={design.id}
                  style={
                    {
                      "--design-color": design.color,
                      "--identity-color": design.color,
                      "--identity-background":
                        design.identityBackground,
                    } as React.CSSProperties
                  }
                >
                  <span className="design-thumbnail" aria-hidden="true">
                    {(isActive || isLeaving) && (
                      <span
                        className={`identity-character ${
                          isActive
                            ? "identity-character-selected"
                            : "identity-character-exiting"
                        }`}
                      >
                        <span className="identity-mask" />
                        <span className="identity-eyes">
                          <span />
                          <span />
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <section
        className={`stage stage-${activeDesign ?? "custom"}`}
        aria-label="Abad * Human"
      >
        {(isLoading || loadingPreview) && (
          <div
            className="stage-loader"
            role="status"
            aria-live="polite"
            style={
              {
                "--loader-color": color,
              } as React.CSSProperties
            }
          >
            <span className="loader-pulse" aria-hidden="true" />
            <span className="sr-only">Preparando la tela</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="flag-canvas"
          aria-label="Lienzo tridimensional interactivo"
        />
      </section>

      <aside
        id="flag-controls"
        className="controls"
        aria-label="Controles de la bandera"
        aria-keyshortcuts="Meta+K Control+K"
        hidden={!controlsOpen}
      >
        <div className="panel-heading">
          <span className="iddqd-mode">IDDQD MODE</span>
          <div className="panel-actions">
            <button className="icon-button" type="button" onClick={reset}>
              Reiniciar
            </button>
          </div>
        </div>

        <div
          className="control-tabs"
          role="tablist"
          aria-label="Grupos de controles"
        >
          <button
            id="motion-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "motion"}
            aria-controls="motion-panel"
            className={activeControlTab === "motion" ? "is-active" : ""}
            onClick={() => setActiveControlTab("motion")}
          >
            <span className="control-tab-icon" aria-hidden="true">≈</span>
            <span className="sr-only">Movimiento</span>
          </button>
          <button
            id="sound-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "sound"}
            aria-controls="sound-panel"
            className={activeControlTab === "sound" ? "is-active" : ""}
            onClick={() => setActiveControlTab("sound")}
          >
            <span className="control-tab-icon" aria-hidden="true">♪</span>
            <span className="sr-only">Sonido</span>
          </button>
          <button
            id="grab-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "grab"}
            aria-controls="grab-panel"
            className={activeControlTab === "grab" ? "is-active" : ""}
            onClick={() => setActiveControlTab("grab")}
          >
            <span className="control-tab-icon" aria-hidden="true">✥</span>
            <span className="sr-only">Agarre</span>
          </button>
          <button
            id="material-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "material"}
            aria-controls="material-panel"
            className={activeControlTab === "material" ? "is-active" : ""}
            onClick={() => setActiveControlTab("material")}
          >
            <span className="control-tab-icon" aria-hidden="true">◇</span>
            <span className="sr-only">Material</span>
          </button>
          <button
            id="lighting-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "lighting"}
            aria-controls="lighting-panel"
            className={activeControlTab === "lighting" ? "is-active" : ""}
            onClick={() => setActiveControlTab("lighting")}
          >
            <span className="control-tab-icon" aria-hidden="true">☼</span>
            <span className="sr-only">Luz</span>
          </button>
          <button
            id="background-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "background"}
            aria-controls="background-panel"
            className={
              activeControlTab === "background" ? "is-active" : ""
            }
            onClick={() => setActiveControlTab("background")}
          >
            <span className="control-tab-icon" aria-hidden="true">◌</span>
            <span className="sr-only">Fondo</span>
          </button>
          <button
            id="artwork-tab"
            type="button"
            role="tab"
            aria-selected={activeControlTab === "artwork"}
            aria-controls="artwork-panel"
            className={activeControlTab === "artwork" ? "is-active" : ""}
            onClick={() => setActiveControlTab("artwork")}
          >
            <span className="control-tab-icon" aria-hidden="true">▦</span>
            <span className="sr-only">Gráfica</span>
          </button>
        </div>

        <div
          id="motion-panel"
          className="control-group control-tab-panel"
          role="tabpanel"
          aria-labelledby="motion-tab"
          hidden={activeControlTab !== "motion"}
        >
          <Control
            label="Tamaño de bandera"
            value={flagSize}
            min={0.42}
            max={1.2}
            step={0.01}
            display={`${Math.round(flagSize * 100)}%`}
            onChange={setFlagSize}
          />
          <Control
            label="Intensidad"
            value={wind.strength}
            min={0}
            max={12}
            manualMax={100}
            step={0.01}
            display={`${wind.strength.toFixed(2)}×`}
            onChange={updateWind("strength")}
          />
          <Control
            label="Turbulencia"
            value={wind.turbulence}
            min={0}
            max={8}
            step={0.01}
            display={`${Math.round((wind.turbulence / 8) * 100)}%`}
            onChange={updateWind("turbulence")}
          />
          <Control
            label="Variación / ráfagas"
            value={wind.gustiness}
            min={0}
            max={3}
            step={0.01}
            display={`${Math.round((wind.gustiness / 3) * 100)}%`}
            onChange={updateWind("gustiness")}
          />
          <Control
            label="Dirección vertical"
            value={wind.direction}
            min={-1}
            max={1}
            step={0.01}
            display={wind.direction > 0.05 ? "↗" : wind.direction < -0.05 ? "↘" : "→"}
            onChange={updateWind("direction")}
          />
          <Control
            label="Velocidad"
            value={wind.speed}
            min={0.15}
            max={12}
            manualMax={300}
            step={0.01}
            display={`${wind.speed.toFixed(1)}×`}
            onChange={updateWind("speed")}
          />
          <Control
            label="Gravedad"
            value={wind.gravity}
            min={0}
            max={1.6}
            step={0.01}
            display={`${Math.round((wind.gravity / 1.6) * 100)}%`}
            onChange={updateWind("gravity")}
          />
        </div>

        <div
          id="grab-panel"
          className="control-group control-tab-panel"
          role="tabpanel"
          aria-labelledby="grab-tab"
          hidden={activeControlTab !== "grab"}
        >
          <p className="grab-control-hint">
            Ajustá cuánto esfuerzo requiere tomar y deformar la tela.
          </p>
          <Control
            label="Resistencia"
            value={grabSettings.resistance}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(grabSettings.resistance * 100)}%`}
            onChange={updateGrab("resistance")}
          />
          <Control
            label="Área afectada"
            value={grabSettings.radius}
            min={0.06}
            max={0.24}
            step={0.005}
            display={`${Math.round(
              (grabSettings.radius / 0.24) * 100,
            )}%`}
            onChange={updateGrab("radius")}
          />
          <Control
            label="Umbral de arrastre"
            value={grabSettings.activationDistance}
            min={2}
            max={30}
            step={1}
            display={`${Math.round(
              grabSettings.activationDistance,
            )} px`}
            onChange={updateGrab("activationDistance")}
          />
          <Control
            label="Inercia al soltar"
            value={grabSettings.inertia}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(grabSettings.inertia * 100)}%`}
            onChange={updateGrab("inertia")}
          />
        </div>

        <div
          id="sound-panel"
          className="control-group control-tab-panel"
          role="tabpanel"
          aria-labelledby="sound-tab"
          hidden={activeControlTab !== "sound"}
        >
          <div className="sound-layer-section">
            <div className="toggle-control ambient-audio-control">
              <div>
                <span>Ambiente</span>
                <small>
                  Cuerpo, aire y ráfagas que acompañan el movimiento
                </small>
              </div>
              <button
                className={`toggle-switch ${
                  windSoundEnabled ? "is-active" : ""
                }`}
                type="button"
                role="switch"
                aria-checked={windSoundEnabled}
                onClick={() => void toggleWindSound()}
              >
                <span aria-hidden="true" />
                <span className="sr-only">
                  {windSoundEnabled
                    ? "Desactivar ambiente"
                    : "Activar ambiente"}
                </span>
              </button>
            </div>
            <Control
              label="Volumen del ambiente"
              value={windSound.volume}
              min={0}
              max={1}
              step={0.01}
              display={`${Math.round(windSound.volume * 100)}%`}
              onChange={(value) => updateWindSound("volume", value)}
            />
            <Control
              label="Cuerpo / graves"
              value={windSound.body}
              min={0}
              max={1.5}
              step={0.01}
              display={`${Math.round(windSound.body * 100)}%`}
              onChange={(value) => updateWindSound("body", value)}
            />
            <Control
              label="Aire / detalle"
              value={windSound.air}
              min={0}
              max={1.5}
              step={0.01}
              display={`${Math.round(windSound.air * 100)}%`}
              onChange={(value) => updateWindSound("air", value)}
            />
            <Control
              label="Profundidad de ráfagas"
              value={windSound.gustDepth}
              min={0}
              max={1.5}
              step={0.01}
              display={`${Math.round(windSound.gustDepth * 100)}%`}
              onChange={(value) => updateWindSound("gustDepth", value)}
            />
          </div>

          <div className="sound-layer-section">
            <div className="toggle-control ambient-audio-control">
              <div>
                <span>Tela y golpes</span>
                <small>
                  Flaps graves con cadencia libre para calibrar primero el timbre
                </small>
              </div>
              <button
                className={`toggle-switch ${
                  clothSoundEnabled ? "is-active" : ""
                }`}
                type="button"
                role="switch"
                aria-checked={clothSoundEnabled}
                onClick={() => void toggleClothSound()}
              >
                <span aria-hidden="true" />
                <span className="sr-only">
                  {clothSoundEnabled
                    ? "Desactivar sonido de tela"
                    : "Activar sonido de tela"}
                </span>
              </button>
            </div>
            <Control
              label="Volumen de tela"
              value={windSound.clothVolume}
              min={0}
              max={1}
              step={0.01}
              display={`${Math.round(windSound.clothVolume * 100)}%`}
              onChange={(value) =>
                updateWindSound("clothVolume", value)
              }
            />
            <Control
              label="Roce / detalle"
              value={windSound.clothRustle}
              min={0}
              max={1.5}
              step={0.01}
              display={`${Math.round(windSound.clothRustle * 100)}%`}
              onChange={(value) =>
                updateWindSound("clothRustle", value)
              }
            />
            <Control
              label="Intensidad de golpes"
              value={windSound.clothImpact}
              min={0}
              max={2}
              step={0.01}
              display={`${Math.round(windSound.clothImpact * 100)}%`}
              onChange={(value) =>
                updateWindSound("clothImpact", value)
              }
            />
            <Control
              label="Gravedad del golpe"
              value={windSound.clothWeight}
              min={0}
              max={1}
              step={0.01}
              display={`${Math.round(windSound.clothWeight * 100)}%`}
              onChange={(value) =>
                updateWindSound("clothWeight", value)
              }
            />
          </div>
        </div>

        <div
          id="material-panel"
          className="control-tab-panel"
          role="tabpanel"
          aria-labelledby="material-tab"
          hidden={activeControlTab !== "material"}
        >
          <div className="mesh-quality-control">
            <div className="section-label">
              <span>Calidad / subdivisión</span>
              <span className="color-code">{meshQuality}×</span>
            </div>
            <div
              className="mesh-quality-options"
              role="group"
              aria-label="Calidad de subdivisión de la tela"
            >
              {([1, 2, 3, 4] as MeshQuality[]).map((quality) => (
                <button
                  key={quality}
                  className={meshQuality === quality ? "is-active" : ""}
                  type="button"
                  aria-pressed={meshQuality === quality}
                  onClick={() => setMeshQuality(quality)}
                >
                  {quality}×
                </button>
              ))}
            </div>
            <small>
              Más subdivisión suaviza pliegues y rasgaduras, pero exige más
              procesamiento.
            </small>
          </div>

          <div className="toggle-control">
            <div>
              <span>Tela rasgada</span>
              <small>Agujeros y cortes físicos en la malla</small>
            </div>
            <button
              className={`toggle-switch ${tornMode ? "is-active" : ""}`}
              type="button"
              role="switch"
              aria-checked={tornMode}
              onClick={() => setTornMode((current) => !current)}
            >
              <span aria-hidden="true" />
              <span className="sr-only">
                {tornMode
                  ? "Desactivar tela rasgada"
                  : "Activar tela rasgada"}
              </span>
            </button>
          </div>

          <div className="material-section">
            <div className="section-label">
              <span>Color de tela</span>
              <span className="color-code">{color.toUpperCase()}</span>
            </div>
            <div className="swatches">
              {FLAG_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  className={`swatch ${color === swatch ? "is-active" : ""}`}
                  type="button"
                  style={{ "--swatch": swatch } as React.CSSProperties}
                  onClick={() => setColor(swatch)}
                  aria-label={`Cambiar color a ${swatch}`}
                  aria-pressed={color === swatch}
                />
              ))}
              <label className="custom-color">
                <span aria-hidden="true">+</span>
                <span className="sr-only">Elegir otro color</span>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="texture-section">
            <div className="section-label">
              <span>Textura de tela</span>
              <span className="color-code">PROCEDURAL</span>
            </div>
            <div className="texture-options">
              {FABRIC_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`texture-option ${
                    materialSettings.preset === preset.id ? "is-active" : ""
                  }`}
                  type="button"
                  onClick={() =>
                    setMaterialSettings((current) => ({
                      ...current,
                      preset: preset.id,
                    }))
                  }
                  aria-pressed={materialSettings.preset === preset.id}
                >
                  <span>{preset.label}</span>
                  <small>{preset.detail}</small>
                </button>
              ))}
            </div>
            <div className="material-controls">
              <Control
                label="Espesor visual"
                value={materialSettings.thickness}
                min={0.004}
                max={0.08}
                step={0.001}
                display={`${Math.round((materialSettings.thickness / 0.08) * 100)}%`}
                onChange={updateMaterial("thickness")}
              />
              <Control
                label="Escala de trama"
                value={materialSettings.scale}
                min={0.35}
                max={2.5}
                step={0.01}
                display={`${materialSettings.scale.toFixed(2)}×`}
                onChange={updateMaterial("scale")}
              />
              <Control
                label="Intensidad normal"
                value={materialSettings.normalStrength}
                min={0}
                max={2.5}
                step={0.01}
                display={`${Math.round((materialSettings.normalStrength / 2.5) * 100)}%`}
                onChange={updateMaterial("normalStrength")}
              />
              <Control
                label="Relieve / bump"
                value={materialSettings.bumpStrength}
                min={0}
                max={1.5}
                step={0.01}
                display={`${Math.round((materialSettings.bumpStrength / 1.5) * 100)}%`}
                onChange={updateMaterial("bumpStrength")}
              />
              <Control
                label="Rugosidad"
                value={materialSettings.roughness}
                min={0.05}
                max={1}
                step={0.01}
                display={`${Math.round(materialSettings.roughness * 100)}%`}
                onChange={updateMaterial("roughness")}
              />
            </div>
          </div>
        </div>

        <div
          id="lighting-panel"
          className="control-group control-tab-panel"
          role="tabpanel"
          aria-labelledby="lighting-tab"
          hidden={activeControlTab !== "lighting"}
        >
          <div
            className={`premiere-control-section ${
              activeDesign === "popcorn" ? "is-available" : ""
            }`}
          >
            <div className="premiere-control-heading">
              <div>
                <span>Reflectores de estreno</span>
                <small>
                  {activeDesign === "popcorn"
                    ? "Haces animados que cruzan y alumbran la tela"
                    : "Preset exclusivo del diseño Popcorn"}
                </small>
              </div>
              {activeDesign === "popcorn" && (
                <button
                  className={`toggle-switch premiere-toggle ${
                    premiereLightsEnabled ? "is-active" : ""
                  }`}
                  type="button"
                  role="switch"
                  aria-checked={premiereLightsEnabled}
                  onClick={() =>
                    setPremiereLightsEnabled((current) => !current)
                  }
                >
                  <span aria-hidden="true" />
                  <span className="sr-only">
                    {premiereLightsEnabled
                      ? "Desactivar reflectores de estreno"
                      : "Activar reflectores de estreno"}
                  </span>
                </button>
              )}
            </div>
            {activeDesign === "popcorn" && premiereLightsEnabled && (
              <div className="premiere-controls">
                <Control
                  label="Intensidad de reflectores"
                  value={lighting.premiereIntensity}
                  min={0}
                  max={3}
                  step={0.01}
                  display={`${lighting.premiereIntensity.toFixed(2)}×`}
                  onChange={updateLighting("premiereIntensity")}
                />
                <Control
                  label="Velocidad de barrido"
                  value={lighting.premiereSpeed}
                  min={0.1}
                  max={3}
                  step={0.01}
                  display={`${lighting.premiereSpeed.toFixed(2)}×`}
                  onChange={updateLighting("premiereSpeed")}
                />
              </div>
            )}
          </div>
          <Control
            label="Luz ambiente"
            value={lighting.ambient}
            min={0}
            max={1.5}
            step={0.01}
            display={`${Math.round((lighting.ambient / 1.5) * 100)}%`}
            onChange={updateLighting("ambient")}
          />
          <Control
            label="Intensidad principal"
            value={lighting.keyIntensity}
            min={0}
            max={3}
            step={0.01}
            display={`${lighting.keyIntensity.toFixed(2)}×`}
            onChange={updateLighting("keyIntensity")}
          />
          <Control
            label="Posición horizontal"
            value={lighting.horizontal}
            min={-1.5}
            max={1.5}
            step={0.01}
            display={lighting.horizontal.toFixed(2)}
            onChange={updateLighting("horizontal")}
          />
          <Control
            label="Altura"
            value={lighting.vertical}
            min={-1.5}
            max={1.5}
            step={0.01}
            display={lighting.vertical.toFixed(2)}
            onChange={updateLighting("vertical")}
          />
          <Control
            label="Profundidad"
            value={lighting.depth}
            min={0.1}
            max={2.5}
            step={0.01}
            display={lighting.depth.toFixed(2)}
            onChange={updateLighting("depth")}
          />
          <Control
            label="Luz de borde"
            value={lighting.rimIntensity}
            min={0}
            max={1.5}
            step={0.01}
            display={`${Math.round((lighting.rimIntensity / 1.5) * 100)}%`}
            onChange={updateLighting("rimIntensity")}
          />
          <div className="light-color-control">
            <div>
              <span>Color de luz</span>
              <small>Fría, neutra o cálida</small>
            </div>
            <label
              className="light-color-picker"
              style={
                {
                  "--light-color": lighting.color,
                } as React.CSSProperties
              }
            >
              <span>{lighting.color.toUpperCase()}</span>
              <input
                type="color"
                value={lighting.color}
                aria-label="Color de luz"
                onChange={(event) =>
                  setLighting((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div
          id="background-panel"
          className="control-group control-tab-panel"
          role="tabpanel"
          aria-labelledby="background-tab"
          hidden={activeControlTab !== "background"}
        >
          <p className="grab-control-hint">
            Ajustes del mesh procedural para el diseño activo. Cada
            diseño conserva sus propios valores durante la sesión.
          </p>
          <Control
            label="Intensidad"
            value={backgroundSettings.intensity}
            min={0.03}
            max={0.1}
            step={0.01}
            display={`${Math.round(
              backgroundSettings.intensity * 100,
            )}%`}
            onChange={(value) =>
              updateBackground("intensity", value)
            }
          />
          <Control
            label="Velocidad"
            value={backgroundSettings.speed}
            min={0}
            max={1.5}
            step={0.01}
            display={`${backgroundSettings.speed.toFixed(2)}×`}
            onChange={(value) => updateBackground("speed", value)}
          />
          <Control
            label="Deformación"
            value={backgroundSettings.warp}
            min={0}
            max={0.6}
            step={0.01}
            display={`${backgroundSettings.warp.toFixed(2)}×`}
            onChange={(value) => updateBackground("warp", value)}
          />
        </div>

        <div
          id="artwork-panel"
          className="control-tab-panel"
          role="tabpanel"
          aria-labelledby="artwork-tab"
          hidden={activeControlTab !== "artwork"}
        >
          <div className="toggle-control loading-preview-control">
            <div>
              <span>Simular loading</span>
              <small>Mantiene visible la pantalla de carga para editarla</small>
            </div>
            <button
              className={`toggle-switch ${
                loadingPreview ? "is-active" : ""
              }`}
              type="button"
              role="switch"
              aria-checked={loadingPreview}
              onClick={() => setLoadingPreview((current) => !current)}
            >
              <span aria-hidden="true" />
              <span className="sr-only">
                {loadingPreview
                  ? "Ocultar simulación de loading"
                  : "Mostrar simulación de loading"}
              </span>
            </button>
          </div>
          <div className="transition-section">
            <div className="section-label">
              <span>Transición entre diseños</span>
              <span className="color-code">
                {transitionMode === "touch"
                  ? "TOQUE"
                  : transitionMode === "tear"
                    ? "RASGADO"
                    : transitionMode === "logo"
                      ? "LOGO"
                      : "TRAMA"}
              </span>
            </div>
            <div
              className="transition-options"
              role="group"
              aria-label="Estilo de transición entre banderas"
            >
              {TRANSITION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={`transition-option ${
                    transitionMode === option.id ? "is-active" : ""
                  }`}
                  type="button"
                  aria-pressed={transitionMode === option.id}
                  onClick={() => setTransitionMode(option.id)}
                >
                  <span>{option.label}</span>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="artwork-row">
            <div className="artwork-copy">
              <span className="section-label">Gráfica</span>
              <span className="file-name">{artworkName}</span>
            </div>
            <label className="upload-button">
              Cargar PNG
              <input type="file" accept="image/png,image/webp" onChange={handleArtwork} />
            </label>
          </div>
          <div className="artwork-scale">
            <Control
              label="Escala de imagen"
              value={artworkScale}
              min={0.25}
              max={2}
              step={0.01}
              display={`${artworkScale.toFixed(2)}×`}
              onChange={updateArtworkScale}
            />
          </div>
        </div>

        <button className="pause-button" type="button" onClick={togglePause}>
          <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
          {paused ? "Continuar animación" : "Pausar animación"}
        </button>
        <div className="runtime-meta" aria-label="Tecnología y rendimiento">
          <span>Three.js · Tela Verlet · Shader GPU</span>
          <span className="runtime-fps">
            <span className="runtime-dot" aria-hidden="true" />
            <span ref={fpsRef}>-- FPS</span>
          </span>
        </div>
      </aside>
    </main>
  );
}

type ControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  manualMax?: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
};

function Control({
  label,
  value,
  min,
  max,
  manualMax,
  step,
  display,
  onChange,
}: ControlProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const numericMax = manualMax ?? max;
  const sliderValue = THREE.MathUtils.clamp(value, min, max);
  const progress = ((sliderValue - min) / (max - min)) * 100;

  const commitDraft = () => {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed)) {
      const clamped = THREE.MathUtils.clamp(parsed, min, numericMax);
      const normalized = Number(clamped.toFixed(6));
      onChange(normalized);
      setDraft(String(normalized));
    } else {
      setDraft(String(value));
    }
    setEditing(false);
  };

  return (
    <div className="range-control">
      <span className="range-heading">
        <label htmlFor={inputId}>{label}</label>
        {editing ? (
          <input
            className="range-value-input"
            type="number"
            min={min}
            max={numericMax}
            step={step}
            value={draft}
            autoFocus
            aria-label={`Editar ${label}`}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(String(value));
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="range-value"
            type="button"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            aria-label={`Editar valor de ${label}: ${display}`}
          >
            {display}
          </button>
        )}
      </span>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
      />
    </div>
  );
}
