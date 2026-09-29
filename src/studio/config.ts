import type { ProceduralBackgroundPalette } from "../proceduralBackground";

export type WindControls = {
  strength: number;
  turbulence: number;
  direction: number;
  speed: number;
  gravity: number;
  gustiness: number;
};

export type MaterialControls = {
  preset: number;
  scale: number;
  thickness: number;
  normalStrength: number;
  bumpStrength: number;
  roughness: number;
  sheenIntensity: number;
};

export type GrabControls = {
  resistance: number;
  radius: number;
  activationDistance: number;
  inertia: number;
};

export type LightingControls = {
  ambient: number;
  keyIntensity: number;
  fillIntensity: number;
  shadowIntensity: number;
  horizontal: number;
  vertical: number;
  depth: number;
  rimIntensity: number;
  color: string;
  premiereIntensity: number;
  premiereSpeed: number;
};

export type WindSoundControls = {
  volume: number;
  body: number;
  air: number;
  gustDepth: number;
  clothVolume: number;
  clothRustle: number;
  clothImpact: number;
  clothWeight: number;
};

export type ClothAudioMetrics = {
  motion: number;
  impact: number;
};

export type ClothStepMetrics = ClothAudioMetrics & {
  releasedGrab: boolean;
};

export type TransitionOrigin = {
  x: number;
  y: number;
  screenX?: number;
  screenY?: number;
};

export type ClothGrabController = {
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

export type DesignTransition = (
  image: HTMLImageElement,
  color: string,
  artworkScale: number,
  direction: number,
  origin: TransitionOrigin,
) => void;

export type WindAudioEngine = {
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
  setRunning: (enabled: boolean) => Promise<void>;
  dispose: () => void;
  startedAt: number;
};

export type DesignPreset = {
  id: string;
  label: string;
  color: string;
  asset: string;
  identityBackground: string;
  background: ProceduralBackgroundPalette;
};

export type BackgroundControls = Pick<
  ProceduralBackgroundPalette,
  "intensity" | "speed" | "warp"
>;

export type FocusControls = {
  enabled: boolean;
  radius: number;
  feather: number;
  blur: number;
  follow: number;
};

export type MoodSettings = {
  wind: WindControls;
  material: MaterialControls;
  lighting: LightingControls;
  background: BackgroundControls;
};

export type MoodPreset = MoodSettings & {
  id: string;
  name: string;
  accent: string;
  custom?: boolean;
};

export type ControlTab =
  | "motion"
  | "sound"
  | "grab"
  | "material"
  | "lighting"
  | "background"
  | "focus"
  | "artwork";
export type MeshQuality = 1 | 2 | 3 | 4;
export type TransitionMode = "logo" | "touch" | "weave" | "tear";
export type ClothAnchor = "left" | "top";

export type ClothLayout = {
  width: number;
  height: number;
  textureWidth: number;
  textureHeight: number;
  anchor: ClothAnchor;
};

export const INITIAL_WIND: WindControls = {
  strength: 4.8,
  turbulence: 8,
  direction: 1,
  speed: 1.35,
  gravity: 1.34,
  gustiness: 3,
};

export const INITIAL_FLAG_SIZE = 1.2;
export const INITIAL_ARTWORK_SCALE = 0.55;
export const INITIAL_MESH_QUALITY: MeshQuality = 3;
export const INITIAL_TRANSITION_MODE: TransitionMode = "logo";
export const MAX_ARTWORK_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_ARTWORK_DIMENSION = 8192;
export const ALLOWED_ARTWORK_TYPES = new Set(["image/png", "image/webp"]);
export const DEFAULT_TRANSITION_ORIGIN: TransitionOrigin = {
  x: 0.5,
  y: 0.5,
  screenX: 0.5,
  screenY: 0.5,
};

export const LANDSCAPE_CLOTH: ClothLayout = {
  width: 3.35,
  height: 1.9,
  textureWidth: 1024,
  textureHeight: 576,
  anchor: "left",
};

export const MOBILE_PORTRAIT_HEIGHT_SCALE = 0.84;
export const MOBILE_PORTRAIT_WIDTH_SCALE = 0.72;
export const MOBILE_ARTWORK_SCALE_MULTIPLIER = 1.45;
export const MOBILE_ARTWORK_VERTICAL_OFFSET = -0.06;
export const FOCUS_BLUR_SCALE = 0.45;
export const SHADOW_BLUR_SCALE_MOBILE = 0.24;
export const SHADOW_BLUR_SCALE_DESKTOP = 0.32;
export const SHADOW_BLUR_RADIUS = 2.4;

export const INITIAL_FOCUS: FocusControls = {
  enabled: false,
  radius: 150,
  feather: 72,
  blur: 1.35,
  follow: 14,
};

export const PORTRAIT_CLOTH: ClothLayout = {
  width: LANDSCAPE_CLOTH.height * MOBILE_PORTRAIT_WIDTH_SCALE,
  height: LANDSCAPE_CLOTH.width * MOBILE_PORTRAIT_HEIGHT_SCALE,
  textureWidth: Math.round(
    LANDSCAPE_CLOTH.textureHeight * MOBILE_PORTRAIT_WIDTH_SCALE,
  ),
  textureHeight: Math.round(
    LANDSCAPE_CLOTH.textureWidth * MOBILE_PORTRAIT_HEIGHT_SCALE,
  ),
  anchor: "top",
};

export const MOBILE_PORTRAIT_QUERY =
  "(max-width: 780px) and (orientation: portrait)";

export const INITIAL_MATERIAL: MaterialControls = {
  preset: 0,
  scale: 3,
  thickness: 0.009,
  normalStrength: 2.23,
  bumpStrength: 1.43,
  roughness: 0.86,
  sheenIntensity: 0.83,
};

export const INITIAL_GRAB: GrabControls = {
  resistance: 1,
  radius: 0.24,
  activationDistance: 30,
  inertia: 0.2,
};

export const INITIAL_WIND_SOUND: WindSoundControls = {
  volume: 0.55,
  body: 0.8,
  air: 0.62,
  gustDepth: 0.82,
  clothVolume: 0.78,
  clothRustle: 0.06,
  clothImpact: 1.35,
  clothWeight: 0.88,
};

export const INITIAL_LIGHTING: LightingControls = {
  ambient: 0.1,
  keyIntensity: 1.14,
  fillIntensity: 0.22,
  shadowIntensity: 0.42,
  horizontal: -0.59,
  vertical: 0.29,
  depth: 0.52,
  rimIntensity: 0.55,
  color: "#FFFFFF",
  premiereIntensity: 1.15,
  premiereSpeed: 1,
};

export const CUSTOM_MOODS_STORAGE_KEY = "abad-human-custom-moods-v1";

export const DEFAULT_MOODS: MoodPreset[] = [
  {
    id: "calma",
    name: "Calma",
    accent: "#A8DADC",
    wind: {
      strength: 1.4,
      turbulence: 2.4,
      direction: 0.35,
      speed: 0.55,
      gravity: 1.15,
      gustiness: 0.8,
    },
    material: {
      preset: 1,
      scale: 1.75,
      thickness: 0.012,
      normalStrength: 0.45,
      bumpStrength: 0.38,
      roughness: 1,
      sheenIntensity: 0.35,
    },
    lighting: {
      ambient: 0.18,
      keyIntensity: 0.82,
      fillIntensity: 0.32,
      shadowIntensity: 0.25,
      horizontal: -0.35,
      vertical: 0.65,
      depth: 1.2,
      rimIntensity: 0.28,
      color: "#FFF4E6",
      premiereIntensity: 0.7,
      premiereSpeed: 0.55,
    },
    background: { intensity: 0.03, speed: 0.16, warp: 0.07 },
  },
  {
    id: "editorial",
    name: "Editorial",
    accent: "#F4F1E9",
    wind: { ...INITIAL_WIND },
    material: { ...INITIAL_MATERIAL },
    lighting: { ...INITIAL_LIGHTING },
    background: { intensity: 0.08, speed: 0.42, warp: 0.2 },
  },
  {
    id: "tormenta",
    name: "Tormenta",
    accent: "#778CFF",
    wind: {
      strength: 8.2,
      turbulence: 8,
      direction: -0.15,
      speed: 2.1,
      gravity: 1.5,
      gustiness: 3,
    },
    material: {
      preset: 3,
      scale: 1.15,
      thickness: 0.018,
      normalStrength: 1.05,
      bumpStrength: 1.08,
      roughness: 0.72,
      sheenIntensity: 1.15,
    },
    lighting: {
      ambient: 0.06,
      keyIntensity: 1.5,
      fillIntensity: 0.15,
      shadowIntensity: 0.65,
      horizontal: -0.95,
      vertical: 0.12,
      depth: 0.35,
      rimIntensity: 0.9,
      color: "#DCE7FF",
      premiereIntensity: 1.7,
      premiereSpeed: 1.8,
    },
    background: { intensity: 0.1, speed: 1.1, warp: 0.5 },
  },
  {
    id: "nocturno",
    name: "Nocturno",
    accent: "#A78BFA",
    wind: {
      strength: 2.4,
      turbulence: 4.2,
      direction: -0.15,
      speed: 0.75,
      gravity: 1.4,
      gustiness: 1.4,
    },
    material: {
      preset: 2,
      scale: 1.4,
      thickness: 0.016,
      normalStrength: 0.82,
      bumpStrength: 0.75,
      roughness: 0.85,
      sheenIntensity: 0.8,
    },
    lighting: {
      ambient: 0.045,
      keyIntensity: 0.72,
      fillIntensity: 0.18,
      shadowIntensity: 0.58,
      horizontal: 0.72,
      vertical: 0.12,
      depth: 0.45,
      rimIntensity: 1.1,
      color: "#91A9FF",
      premiereIntensity: 1.3,
      premiereSpeed: 0.7,
    },
    background: { intensity: 0.095, speed: 0.22, warp: 0.28 },
  },
];

export const moodSettingsSignature = (settings: MoodSettings) =>
  [
    settings.wind.strength,
    settings.wind.turbulence,
    settings.wind.direction,
    settings.wind.speed,
    settings.wind.gravity,
    settings.wind.gustiness,
    settings.material.preset,
    settings.material.scale,
    settings.material.thickness,
    settings.material.normalStrength,
    settings.material.bumpStrength,
    settings.material.roughness,
    settings.material.sheenIntensity,
    settings.lighting.ambient,
    settings.lighting.keyIntensity,
    settings.lighting.fillIntensity,
    settings.lighting.shadowIntensity,
    settings.lighting.horizontal,
    settings.lighting.vertical,
    settings.lighting.depth,
    settings.lighting.rimIntensity,
    settings.lighting.color.toUpperCase(),
    settings.lighting.premiereIntensity,
    settings.lighting.premiereSpeed,
    settings.background.intensity,
    settings.background.speed,
    settings.background.warp,
  ].join("|");

const finiteFields = (value: unknown, ranges: Record<string, readonly [number, number]>) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.entries(ranges).every(([key, [min, max]]) => typeof fields[key] === "number" && Number.isFinite(fields[key]) && (fields[key] as number) >= min && (fields[key] as number) <= max);
};
const hexColor = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export const isStoredMood = (value: unknown): value is MoodPreset => {
  if (!value || typeof value !== "object") return false;
  const mood = value as Partial<MoodPreset>;
  return typeof mood.id === "string" && mood.id.length > 0 && mood.id.length < 150 &&
    typeof mood.name === "string" && mood.name.trim().length > 0 && mood.name.length <= 18 && hexColor(mood.accent) &&
    finiteFields(mood.wind, { strength: [0, 100], turbulence: [0, 8], direction: [-1, 1], speed: [.01, 300], gravity: [0, 1.6], gustiness: [0, 3] }) &&
    finiteFields(mood.material, { preset: [0, 4], scale: [.35, 10], thickness: [.004, .08], normalStrength: [0, 2.5], bumpStrength: [0, 1.5], roughness: [.05, 1], sheenIntensity: [0, 1.5] }) && Number.isInteger(mood.material?.preset) &&
    finiteFields(mood.lighting, { ambient: [0, 1.5], keyIntensity: [0, 3], fillIntensity: [0, 1], shadowIntensity: [0, 1], horizontal: [-1.5, 1.5], vertical: [-1.5, 1.5], depth: [.1, 2.5], rimIntensity: [0, 1.5], premiereIntensity: [0, 3], premiereSpeed: [.1, 3] }) && hexColor(mood.lighting?.color) &&
    finiteFields(mood.background, { intensity: [0, .1], speed: [0, 1.5], warp: [0, .6] });
};

export const loadCustomMoods = (): MoodPreset[] => {
  try {
    const stored = window.localStorage.getItem(CUSTOM_MOODS_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isStoredMood)
      .slice(0, 30)
      .map((mood) => ({ ...mood, custom: true }));
  } catch {
    return [];
  }
};

export const getBackgroundControls = (
  palette: ProceduralBackgroundPalette,
): BackgroundControls => ({
  intensity: palette.intensity,
  speed: palette.speed,
  warp: palette.warp,
});

export const DESIGN_PRESETS: DesignPreset[] = [
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

export const INITIAL_DESIGN = DESIGN_PRESETS[0];
export const FLAG_COLORS = DESIGN_PRESETS.map((design) => design.color);

export const FABRIC_PRESETS = [
  { id: 0, label: "Algodón", detail: "Trama plana" },
  { id: 1, label: "Lino", detail: "Fibra irregular" },
  { id: 2, label: "Sarga", detail: "Tejido diagonal" },
  { id: 3, label: "Ripstop", detail: "Malla técnica" },
  { id: 4, label: "Liso", detail: "Sin microtrama" },
];

export const TRANSITION_OPTIONS: {
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

export function getTransitionModeValue(mode: TransitionMode) {
  if (mode === "tear") return 1;
  if (mode === "touch") return 2;
  if (mode === "logo") return 3;
  return 0;
}
