import {
  ChangeEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  CUSTOM_BACKGROUND_PALETTE,
  proceduralBackgroundCompositeFragmentShader,
  proceduralBackgroundFragmentShader,
  proceduralBackgroundVertexShader,
  type ProceduralBackgroundPalette,
} from "./proceduralBackground";

import {
  type WindControls,
  type MaterialControls,
  type GrabControls,
  type LightingControls,
  type WindSoundControls,
  type ClothAudioMetrics,
  type TransitionOrigin,
  type ClothGrabController,
  type DesignTransition,
  type WindAudioEngine,
  type DesignPreset,
  type BackgroundControls,
  type FocusControls,
  type MoodPreset,
  type ControlTab,
  type MeshQuality,
  type TransitionMode,
  INITIAL_WIND,
  INITIAL_FLAG_SIZE,
  INITIAL_ARTWORK_SCALE,
  INITIAL_MESH_QUALITY,
  INITIAL_TRANSITION_MODE,
  MAX_ARTWORK_FILE_SIZE,
  MAX_ARTWORK_DIMENSION,
  ALLOWED_ARTWORK_TYPES,
  DEFAULT_TRANSITION_ORIGIN,
  LANDSCAPE_CLOTH,
  MOBILE_ARTWORK_SCALE_MULTIPLIER,
  MOBILE_ARTWORK_VERTICAL_OFFSET,
  FOCUS_BLUR_SCALE,
  SHADOW_BLUR_SCALE_MOBILE,
  SHADOW_BLUR_SCALE_DESKTOP,
  SHADOW_BLUR_RADIUS,
  INITIAL_FOCUS,
  PORTRAIT_CLOTH,
  MOBILE_PORTRAIT_QUERY,
  INITIAL_MATERIAL,
  INITIAL_GRAB,
  INITIAL_WIND_SOUND,
  INITIAL_LIGHTING,
  CUSTOM_MOODS_STORAGE_KEY,
  DEFAULT_MOODS,
  moodSettingsSignature,
  loadCustomMoods,
  getBackgroundControls,
  DESIGN_PRESETS,
  INITIAL_DESIGN,
  getTransitionModeValue,
} from "./studio/config";
import {
  vertexShader,
  fragmentShader,
  edgeVertexShader,
  edgeFragmentShader,
  clothShadowVertexShader,
  clothShadowFragmentShader,
  clothShadowCompositeFragmentShader,
  focusBlurFragmentShader,
  focusCompositeFragmentShader,
} from "./studio/shaders";
import { createEmptyArtwork, designImageCache, drawArtworkImage, resizeArtwork } from "./studio/artwork";
import { createClothEdgeGeometry } from "./cloth/topology";
import { FrameSamples, GpuTimer } from "./studio/performance";
import { ClothSimulation } from "./cloth/simulation";
import { createClothSurface, physicsResolution } from "./cloth/surface";

const StudioControls = __LOCAL_CONTROLS__ ? lazy(() => import("@local-controls")) : null;

export function FlagStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
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
  const focusControlsRef = useRef(INITIAL_FOCUS);
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
  const audioMountedRef = useRef(true);
  const pauseRef = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const invalidateSceneRef = useRef<() => void>(() => undefined);
  const physicsMaterialRef = useRef<(thickness: number, preset: number) => void>(() => undefined);
  const cancelGrabRef = useRef<() => void>(() => undefined);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [retryDesign, setRetryDesign] = useState<string | null>(null);
  const uploadUrlRef = useRef<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reducedMotionRef = useRef(reducedMotion);
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
  const [focusControls, setFocusControls] = useState(INITIAL_FOCUS);
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
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [isLoading, setIsLoading] = useState(true);
  const [sceneRevealed, setSceneRevealed] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isNavigationDragging, setIsNavigationDragging] = useState(false);
  const [windSoundEnabled, setWindSoundEnabled] = useState(false);
  const [clothSoundEnabled, setClothSoundEnabled] = useState(false);
  const [windSound, setWindSound] = useState(INITIAL_WIND_SOUND);
  const [artworkName, setArtworkName] = useState(INITIAL_DESIGN.label);
  const [customMoods, setCustomMoods] = useState<MoodPreset[]>(
    () => __LOCAL_CONTROLS__ ? loadCustomMoods() : [],
  );
  const [appliedMoodId, setAppliedMoodId] = useState<string | null>(
    "editorial",
  );
  const [moodEditorOpen, setMoodEditorOpen] = useState(false);
  const [moodNameDraft, setMoodNameDraft] = useState("");
  const [usesPortraitCloth, setUsesPortraitCloth] = useState(
    () => window.matchMedia(MOBILE_PORTRAIT_QUERY).matches,
  );
  const allMoods = useMemo(
    () => __LOCAL_CONTROLS__ ? [...DEFAULT_MOODS, ...customMoods] : [],
    [customMoods],
  );
  const appliedMood = allMoods.find((mood) => mood.id === appliedMoodId);
  const activeMoodId =
    appliedMood &&
    moodSettingsSignature({
      wind,
      material: materialSettings,
      lighting,
      background: backgroundSettings,
    }) === moodSettingsSignature(appliedMood)
      ? appliedMood.id
      : null;

  useEffect(() => {
    if (!__LOCAL_CONTROLS__) return;
    try {
      window.localStorage.setItem(
        CUSTOM_MOODS_STORAGE_KEY,
        JSON.stringify(customMoods),
      );
    } catch {
      // The mood still works for the current session if storage is blocked.
    }
  }, [customMoods]);

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
    if (!__LOCAL_CONTROLS__) return;
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
    const artworkScaleMultiplier = usesPortraitCloth
      ? MOBILE_ARTWORK_SCALE_MULTIPLIER
      : 1;
    const artworkVerticalOffset = usesPortraitCloth
      ? MOBILE_ARTWORK_VERTICAL_OFFSET
      : 0;
    const settings = simulationSettingsRef.current;
    setIsLoading(true);
    let disposed = false;
    let firstFramePending = true;
    let artworkReady = false;

    let prefersReducedMotion = reducedMotionRef.current;
    const supportsHoverFocus = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    ).matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "default" });
    } catch {
      queueMicrotask(() => {
        if (!disposed) { setIsLoading(false); setWebglError("La vista 3D no está disponible en este dispositivo."); }
      });
      return () => { disposed = true; };
    }
    queueMicrotask(() => { if (!disposed) setWebglError(null); });
    const gpuTimer = __LOCAL_CONTROLS__ ? new GpuTimer(renderer.getContext()) : null;
    const physicsSamples = new FrameSamples();
    const renderSamples = __LOCAL_CONTROLS__ ? new FrameSamples() : null;
    const frameSamples = __LOCAL_CONTROLS__ ? new FrameSamples() : null;
    let scheduleRender = () => {};
    let sceneDirty = true;
    const invalidate = () => { sceneDirty = true; scheduleRender(); };
    invalidateSceneRef.current = invalidate;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

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

    const focusPipeline = supportsHoverFocus
      ? (() => {
          const sceneRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
          });
          const blurHorizontalTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
          });
          const blurVerticalTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
          });
          sceneRenderTarget.texture.generateMipmaps = false;
          blurHorizontalTarget.texture.generateMipmaps = false;
          blurVerticalTarget.texture.generateMipmaps = false;
          sceneRenderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
          blurHorizontalTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
          blurVerticalTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

          const geometry = new THREE.PlaneGeometry(2, 2);
          const blurHorizontalScene = new THREE.Scene();
          const blurHorizontalMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uTexture: { value: sceneRenderTarget.texture },
              uTexelStep: { value: new THREE.Vector2(1, 0) },
            },
            vertexShader: proceduralBackgroundVertexShader,
            fragmentShader: focusBlurFragmentShader,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          });
          const blurHorizontalMesh = new THREE.Mesh(
            geometry,
            blurHorizontalMaterial,
          );
          blurHorizontalMesh.frustumCulled = false;
          blurHorizontalScene.add(blurHorizontalMesh);

          const blurVerticalScene = new THREE.Scene();
          const blurVerticalMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uTexture: { value: blurHorizontalTarget.texture },
              uTexelStep: { value: new THREE.Vector2(0, 1) },
            },
            vertexShader: proceduralBackgroundVertexShader,
            fragmentShader: focusBlurFragmentShader,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          });
          const blurVerticalMesh = new THREE.Mesh(
            geometry,
            blurVerticalMaterial,
          );
          blurVerticalMesh.frustumCulled = false;
          blurVerticalScene.add(blurVerticalMesh);

          const compositeUniforms: Record<string, THREE.IUniform> = {
            uSharpTexture: { value: sceneRenderTarget.texture },
            uBlurredTexture: { value: blurVerticalTarget.texture },
            uFocusCenter: { value: new THREE.Vector2(0.5, 0.5) },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uFocusAmount: { value: 0 },
            uFocusRadius: { value: INITIAL_FOCUS.radius },
            uFocusFeather: { value: INITIAL_FOCUS.feather },
          };
          const compositeScene = new THREE.Scene();
          const compositeMaterial = new THREE.ShaderMaterial({
            uniforms: compositeUniforms,
            vertexShader: proceduralBackgroundVertexShader,
            fragmentShader: focusCompositeFragmentShader,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          });
          const compositeMesh = new THREE.Mesh(
            geometry,
            compositeMaterial,
          );
          compositeMesh.frustumCulled = false;
          compositeScene.add(compositeMesh);

          return {
            sceneRenderTarget,
            blurHorizontalTarget,
            blurVerticalTarget,
            geometry,
            blurHorizontalScene,
            blurHorizontalMaterial,
            blurVerticalScene,
            blurVerticalMaterial,
            compositeScene,
            compositeMaterial,
            compositeUniforms,
          };
        })()
      : null;
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

      invalidate();
      if (prefersReducedMotion) {
        backgroundUniforms.uBackgroundMix.value = 1;
        return;
      }

      backgroundUniforms.uBackgroundMix.value = 0;
      const startedAt = performance.now();
      const duration = 1080;
      const animateBackgroundTransition = (now: number) => {
        invalidate();
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

    const { columns, rows } = physicsResolution(meshQuality, usesPortraitCloth);
    const surface = createClothSurface(clothLayout, columns, rows, meshQuality === 1 ? 2 : 3);
    const { geometry, intactIndex, tornIndex } = surface;
    const clothSimulation = new ClothSimulation(
      surface.physical.getAttribute("position").array as Float32Array,
      columns, rows, clothLayout,
      surface.intact.array as Uint16Array,
      surface.torn.array as Uint16Array,
    );
    clothSimulation.configureMaterial(settings.material.thickness, settings.material.preset);
    physicsMaterialRef.current = (thickness, preset) => clothSimulation.configureMaterial(thickness, preset);
    surface.update(clothSimulation.renderPositions, clothSimulation.normals);
    const intactClothEdge = createClothEdgeGeometry(
      geometry,
      intactIndex,
    );
    const tornClothEdge = createClothEdgeGeometry(geometry, tornIndex);
    let activeClothEdge = intactClothEdge;
    simulationResetRef.current = () => {
      clothSimulation.reset();
      surface.update(clothSimulation.renderPositions, clothSimulation.normals);
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
        artworkScaleMultiplier,
        artworkVerticalOffset,
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
        if (disposed || designLoadRef.current !== initialLoadToken) return;
        designImageCache.set(selectedDesign.asset, initialImage);
        artworkImageRef.current = initialImage;
        drawArtworkImage(
          artworkCanvas,
          initialImage,
          artworkScaleRef.current,
          artworkScaleMultiplier,
          artworkVerticalOffset,
        );
        artworkTexture.needsUpdate = true;
        copyCurrentArtworkToPrevious();
        setArtworkName(selectedDesign.label);
        artworkReady = true;
        invalidate();
      };
      initialImage.onerror = () => {
        if (disposed || designLoadRef.current !== initialLoadToken) return;
        artworkReady = true;
        setArtworkError("No se pudo cargar el diseño. Podés reintentarlo.");
        setRetryDesign(selectedDesign.id);
        invalidate();
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
      uDetailQuality: { value: meshQuality === 1 ? 0 : 1 },
      uBumpStrength: { value: settings.material.bumpStrength },
      uRoughness: { value: settings.material.roughness },
      uSheenIntensity: { value: settings.material.sheenIntensity },
      uAmbientIntensity: { value: settings.lighting.ambient },
      uKeyIntensity: { value: settings.lighting.keyIntensity },
      uFillIntensity: { value: settings.lighting.fillIntensity },
      uShadowIntensity: { value: settings.lighting.shadowIntensity },
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
      drawArtworkImage(
        artworkCanvas,
        image,
        nextArtworkScale,
        artworkScaleMultiplier,
        artworkVerticalOffset,
      );
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

      invalidate();
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
        invalidate();
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
        uFillIntensity: uniforms.uFillIntensity,
        uLightX: uniforms.uLightX,
        uLightY: uniforms.uLightY,
        uLightZ: uniforms.uLightZ,
        uLightColor: uniforms.uLightColor,
      },
      vertexShader: edgeVertexShader,
      fragmentShader: edgeFragmentShader,
      side: THREE.DoubleSide,
    });

    const shadowMaskTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const shadowBlurHorizontalTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const shadowBlurVerticalTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    shadowMaskTarget.texture.generateMipmaps = false;
    shadowBlurHorizontalTarget.texture.generateMipmaps = false;
    shadowBlurVerticalTarget.texture.generateMipmaps = false;

    const shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFlagSize: uniforms.uFlagSize,
        uTransitionScale: uniforms.uTransitionScale,
        uLightX: uniforms.uLightX,
        uLightY: uniforms.uLightY,
        uShadowSpread: { value: 1.01 },
        uShadowOffset: { value: 0.032 },
        uShadowDepth: { value: 0.05 },
      },
      vertexShader: clothShadowVertexShader,
      fragmentShader: clothShadowFragmentShader,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shadowSurface = new THREE.Mesh(geometry, shadowMaterial);
    shadowSurface.frustumCulled = false;
    const shadowGroup = new THREE.Group();
    shadowGroup.add(shadowSurface);
    const shadowScene = new THREE.Scene();
    shadowScene.add(shadowGroup);

    const shadowPostGeometry = new THREE.PlaneGeometry(2, 2);
    const shadowBlurHorizontalScene = new THREE.Scene();
    const shadowBlurHorizontalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: shadowMaskTarget.texture },
        uTexelStep: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: proceduralBackgroundVertexShader,
      fragmentShader: focusBlurFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shadowBlurHorizontalMesh = new THREE.Mesh(
      shadowPostGeometry,
      shadowBlurHorizontalMaterial,
    );
    shadowBlurHorizontalMesh.frustumCulled = false;
    shadowBlurHorizontalScene.add(shadowBlurHorizontalMesh);

    const shadowBlurVerticalScene = new THREE.Scene();
    const shadowBlurVerticalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: shadowBlurHorizontalTarget.texture },
        uTexelStep: { value: new THREE.Vector2(0, 1) },
      },
      vertexShader: proceduralBackgroundVertexShader,
      fragmentShader: focusBlurFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shadowBlurVerticalMesh = new THREE.Mesh(
      shadowPostGeometry,
      shadowBlurVerticalMaterial,
    );
    shadowBlurVerticalMesh.frustumCulled = false;
    shadowBlurVerticalScene.add(shadowBlurVerticalMesh);

    const shadowCompositeScene = new THREE.Scene();
    const shadowCompositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uShadowTexture: { value: shadowBlurVerticalTarget.texture },
        uShadowColor: { value: new THREE.Color("#030208") },
        uShadowIntensity: uniforms.uShadowIntensity,
      },
      vertexShader: proceduralBackgroundVertexShader,
      fragmentShader: clothShadowCompositeFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shadowCompositeMesh = new THREE.Mesh(
      shadowPostGeometry,
      shadowCompositeMaterial,
    );
    shadowCompositeMesh.frustumCulled = false;
    shadowCompositeScene.add(shadowCompositeMesh);

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
      surface.update(clothSimulation.renderPositions, clothSimulation.normals);
      activeClothEdge.update();
      geometry.computeBoundingSphere();
      invalidate();
    };

    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const focusPointer = new THREE.Vector2(0.5, 0.5);
    const focusPointerTarget = new THREE.Vector2(0.5, 0.5);
    let focusAmount = 0;
    let focusAmountTarget = 0;
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
    let animationFrame = 0;
    let lastTimestamp: number | null = null;
    let physicsBudget = 4;
    let fpsFrames = 0;
    let fpsElapsed = 0;
    let renderScale = 1;
    let lowFpsIntervals = 0;
    let highFpsIntervals = 0;
    const drawingBufferSize = new THREE.Vector2();
    const focusBlurResolution = new THREE.Vector2(1, 1);

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
      const shadowBlurScale =
        width < 780
          ? SHADOW_BLUR_SCALE_MOBILE
          : SHADOW_BLUR_SCALE_DESKTOP;
      const shadowBlurWidth = Math.max(
        1,
        Math.round(drawingBufferSize.x * shadowBlurScale),
      );
      const shadowBlurHeight = Math.max(
        1,
        Math.round(drawingBufferSize.y * shadowBlurScale),
      );
      shadowMaskTarget.setSize(shadowBlurWidth, shadowBlurHeight);
      shadowBlurHorizontalTarget.setSize(
        shadowBlurWidth,
        shadowBlurHeight,
      );
      shadowBlurVerticalTarget.setSize(
        shadowBlurWidth,
        shadowBlurHeight,
      );
      (
        shadowBlurHorizontalMaterial.uniforms.uTexelStep
          .value as THREE.Vector2
      ).set(SHADOW_BLUR_RADIUS / shadowBlurWidth, 0);
      (
        shadowBlurVerticalMaterial.uniforms.uTexelStep
          .value as THREE.Vector2
      ).set(0, SHADOW_BLUR_RADIUS / shadowBlurHeight);
      if (focusPipeline) {
        const focusBlurWidth = Math.max(
          1,
          Math.round(drawingBufferSize.x * FOCUS_BLUR_SCALE),
        );
        const focusBlurHeight = Math.max(
          1,
          Math.round(drawingBufferSize.y * FOCUS_BLUR_SCALE),
        );
        focusPipeline.sceneRenderTarget.setSize(
          Math.max(1, Math.round(drawingBufferSize.x)),
          Math.max(1, Math.round(drawingBufferSize.y)),
        );
        focusPipeline.blurHorizontalTarget.setSize(
          focusBlurWidth,
          focusBlurHeight,
        );
        focusPipeline.blurVerticalTarget.setSize(
          focusBlurWidth,
          focusBlurHeight,
        );
        focusBlurResolution.set(focusBlurWidth, focusBlurHeight);
        (
          focusPipeline.blurHorizontalMaterial.uniforms.uTexelStep
            .value as THREE.Vector2
        ).set(focusControlsRef.current.blur / focusBlurWidth, 0);
        (
          focusPipeline.blurVerticalMaterial.uniforms.uTexelStep
            .value as THREE.Vector2
        ).set(0, focusControlsRef.current.blur / focusBlurHeight);
        (
          focusPipeline.compositeUniforms.uResolution
            .value as THREE.Vector2
        ).set(width, height);
      }
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
            LANDSCAPE_CLOTH.height *
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
      invalidate();
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
      invalidate();
      const bounds = canvas.getBoundingClientRect();
      if (supportsHoverFocus && focusControlsRef.current.enabled) {
        focusPointerTarget.set(
          THREE.MathUtils.clamp(
            (event.clientX - bounds.left) / Math.max(bounds.width, 1),
            0,
            1,
          ),
          THREE.MathUtils.clamp(
            1 -
              (event.clientY - bounds.top) /
                Math.max(bounds.height, 1),
            0,
            1,
          ),
        );
        focusAmountTarget = 1;
      }

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
            .worldToLocal(dragWorldPoint)
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

      pointerTarget.x =
        ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      pointerTarget.y =
        ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    };
    const handlePointerLeave = () => {
      if (!tapStart.grabbed) pointerTarget.set(0, 0);
      focusAmountTarget = 0;
      invalidate();
    };
    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || pauseRef.current) return;
      invalidate();
      const { intersection, visualScale } = intersectFlag(
        event.clientX,
        event.clientY,
      );
      tapStart.pointerId = event.pointerId;
      tapStart.x = event.clientX;
      tapStart.y = event.clientY;
      tapStart.grabbed = false;
      if (__LOCAL_CONTROLS__) delete canvas.dataset.autoReleased;
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
    const cancelGrab = () => {
      const pointerId = tapStart.pointerId;
      tapStart.pointerId = null; tapStart.grabbed = false;
      clothSimulation.releaseGrab();
      canvas.classList.remove("is-grab-ready", "is-grabbing");
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      invalidate();
    };
    cancelGrabRef.current = cancelGrab;
    const handleCanvasPointerCancel = (event: PointerEvent) => {
      if (tapStart.pointerId === event.pointerId) cancelGrab();
    };
    const handleVisibility = () => {
      cancelGrab(); clothSimulation.resetClock(); lastTimestamp = null;
      fpsFrames = 0; fpsElapsed = 0;
      if (document.hidden) { window.cancelAnimationFrame(animationFrame); animationFrame = 0; }
      else invalidate();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault(); cancelGrab();
      window.cancelAnimationFrame(animationFrame); animationFrame = 0;
      setWebglError("La vista 3D se interrumpió. Podés reintentar o seguir con la vista estática.");
    };
    const handleContextRestored = () => setRendererGeneration((value) => value + 1);

    const render = (timestamp?: number) => {
      animationFrame = 0;
      if (disposed || document.hidden || renderer.getContext().isContextLost()) return;
      const renderStarted = __LOCAL_CONTROLS__ ? performance.now() : 0;
      prefersReducedMotion = reducedMotionRef.current;
      const now = timestamp ?? performance.now();
      const rawDelta = lastTimestamp === null ? 0 : Math.max(0, (now - lastTimestamp) / 1000);
      const delta = Math.min(rawDelta, 0.05);
      lastTimestamp = now;
      if (rawDelta > 0 && !pauseRef.current) frameSamples?.add(rawDelta * 1000);
      fpsFrames += 1;
      fpsElapsed += rawDelta;
      if (fpsElapsed >= 0.75) {
        const measuredFps = fpsFrames / fpsElapsed;
        const cpu = physicsSamples.summary();
        if (__LOCAL_CONTROLS__ && fpsRef.current && gpuTimer && frameSamples && renderSamples) {
          const gpu = gpuTimer.samples.summary();
          const frames = frameSamples.summary();
          fpsRef.current.textContent = `${Math.round(measuredFps)} FPS · Física ${cpu.median.toFixed(1)} ms · P95 ${frames.p95.toFixed(1)} ms`;
          fpsRef.current.title = `Física P95: ${cpu.p95.toFixed(1)} ms · ${gpuTimer.available ? `GPU: ${gpu.median.toFixed(1)} ms` : `Envío de render CPU: ${renderSamples.summary().median.toFixed(1)} ms`}`;
        }
        if (measuredFps < 50) {
          lowFpsIntervals++; highFpsIntervals = 0;
          if (lowFpsIntervals >= 3) {
            if (cpu.median > 5 && physicsBudget > 3) {
              physicsBudget--; clothSimulation.setBudget(physicsBudget);
            } else if (renderScale > .76) {
              renderScale = Math.max(.75, renderScale - .1);
              uniforms.uDetailQuality.value = renderScale <= .85 || meshQuality === 1 ? 0 : 1;
              resize();
            }
            lowFpsIntervals = 0;
          }
        } else if (measuredFps > 58) {
          highFpsIntervals++; lowFpsIntervals = 0;
          if (highFpsIntervals >= 8) {
            if (physicsBudget < 4 && cpu.p95 < 4) { physicsBudget++; clothSimulation.setBudget(physicsBudget); }
            else if (renderScale < .99) { renderScale = Math.min(1, renderScale + .05); uniforms.uDetailQuality.value = renderScale <= .85 || meshQuality === 1 ? 0 : 1; resize(); }
            highFpsIntervals = 0;
          }
        } else { lowFpsIntervals = 0; highFpsIntervals = 0; }
        fpsFrames = 0;
        fpsElapsed = 0;
      }
      if (!pauseRef.current) {
        uniforms.uTime.value += delta;
        clothSimulation.setAudioEnabled(windLayerEnabledRef.current || clothLayerEnabledRef.current);
        const currentWind = windRef.current;
        const effectiveWind = prefersReducedMotion
          ? { ...currentWind, strength: currentWind.strength * .35, turbulence: currentWind.turbulence * .25, speed: currentWind.speed * .4 }
          : currentWind;
        const clothMetrics = clothSimulation.step(delta, effectiveWind, transitionGustRef.current);
        if (clothSimulation.timings.steps) physicsSamples.add(clothSimulation.timings.total);
        if (clothMetrics.releasedGrab && tapStart.grabbed) {
          const releasedPointerId = tapStart.pointerId;
          tapStart.pointerId = null;
          tapStart.grabbed = false;
          if (__LOCAL_CONTROLS__) canvas.dataset.autoReleased = "collision";
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
        surface.update(clothSimulation.renderPositions, clothSimulation.normals);
        activeClothEdge.update();
      } else {
        clothAudioRef.current = { motion: 0, impact: 0 };
      }

      const visualDelta = delta || 1 / 60;
      const pointerMoving = pointer.distanceToSquared(pointerTarget) > .000001;
      pointer.lerp(pointerTarget, 1 - Math.exp(-2.8 * visualDelta));
      const currentFocusControls = focusControlsRef.current;
      if (!currentFocusControls.enabled) focusAmountTarget = 0;
      const focusFollow = prefersReducedMotion
        ? 1
        : 1 - Math.exp(-visualDelta * currentFocusControls.follow);
      const focusFade = prefersReducedMotion
        ? 1
        : 1 -
          Math.exp(
            -visualDelta * Math.max(6, currentFocusControls.follow * 0.72),
          );
      focusPointer.lerp(focusPointerTarget, focusFollow);
      focusAmount = THREE.MathUtils.lerp(
        focusAmount,
        focusAmountTarget,
        focusFade,
      );
      if (focusPipeline) {
        (
          focusPipeline.compositeUniforms.uFocusCenter
            .value as THREE.Vector2
        ).copy(focusPointer);
        focusPipeline.compositeUniforms.uFocusAmount.value = focusAmount;
        focusPipeline.compositeUniforms.uFocusRadius.value =
          currentFocusControls.radius;
        focusPipeline.compositeUniforms.uFocusFeather.value =
          currentFocusControls.feather;
        (
          focusPipeline.blurHorizontalMaterial.uniforms.uTexelStep
            .value as THREE.Vector2
        ).set(
          currentFocusControls.blur /
            Math.max(focusBlurResolution.x, 1),
          0,
        );
        (
          focusPipeline.blurVerticalMaterial.uniforms.uTexelStep
            .value as THREE.Vector2
        ).set(
          0,
          currentFocusControls.blur /
            Math.max(focusBlurResolution.y, 1),
        );
      }
      const baseFlagRotationY = usesPortraitCloth ? -0.08 : -0.12;
      flag.rotation.y = THREE.MathUtils.lerp(
        flag.rotation.y,
        baseFlagRotationY + pointer.x * 0.08,
        1 - Math.exp(-2.5 * visualDelta),
      );
      flag.rotation.x = THREE.MathUtils.lerp(flag.rotation.x, -0.025 - pointer.y * 0.045, 1 - Math.exp(-2.5 * visualDelta));
      backgroundUniforms.uBackgroundTime.value =
        uniforms.uTime.value;
      (
        backgroundUniforms.uBackgroundPointer.value as THREE.Vector2
      ).copy(pointer);
      const moving = !pauseRef.current;
      const transitioning = uniforms.uDesignTransition.value < .999 || backgroundUniforms.uBackgroundMix.value < .999;
      const focusMoving = Math.abs(focusAmount - focusAmountTarget) > .001 || focusPointer.distanceToSquared(focusPointerTarget) > .000001;
      const orientationMoving = Math.abs(flag.rotation.y - (baseFlagRotationY + pointer.x * .08)) > .0001 || Math.abs(flag.rotation.x - (-.025 - pointer.y * .045)) > .0001;
      backgroundUniforms.uBackgroundMotion.value = prefersReducedMotion ? 0 : usesPortraitCloth ? .62 : 1;
      gpuTimer?.begin();
      const gpuSubmissionStarted = __LOCAL_CONTROLS__ ? performance.now() : 0;
      backgroundRenderFrame += 1;
      if (
        backgroundNeedsRender || sceneDirty || pointerMoving || transitioning ||
        (moving && !prefersReducedMotion && backgroundRenderFrame % 2 === 0)
      ) {
        renderer.setRenderTarget(backgroundRenderTarget);
        renderer.clear(true, true, true);
        renderer.render(backgroundScene, backgroundCamera);
        renderer.setRenderTarget(null);
        backgroundNeedsRender = false;
      }

      const shadowEnabled = uniforms.uShadowIntensity.value > .001;
      if (shadowEnabled && (moving || sceneDirty || pointerMoving || orientationMoving || transitioning)) {
        shadowGroup.position.copy(flag.position);
        shadowGroup.rotation.copy(flag.rotation);
        shadowGroup.scale.copy(flag.scale);
        renderer.setRenderTarget(shadowMaskTarget);
        renderer.clear(true, true, true);
        renderer.render(shadowScene, camera);
        shadowBlurHorizontalMaterial.uniforms.uTexture.value = shadowMaskTarget.texture;
        renderer.setRenderTarget(shadowBlurHorizontalTarget);
        renderer.clear(true, true, true);
        renderer.render(shadowBlurHorizontalScene, backgroundCamera);
        renderer.setRenderTarget(shadowBlurVerticalTarget);
        renderer.clear(true, true, true);
        renderer.render(shadowBlurVerticalScene, backgroundCamera);
      }

      if (focusPipeline && focusAmount > 0.001) {
        renderer.setRenderTarget(focusPipeline.sceneRenderTarget);
        renderer.clear(true, true, true);
        renderer.render(
          backgroundCompositeScene,
          backgroundCamera,
        );
        if (shadowEnabled) renderer.render(shadowCompositeScene, backgroundCamera);
        renderer.clearDepth();
        renderer.render(scene, camera);

        renderer.setRenderTarget(focusPipeline.blurHorizontalTarget);
        renderer.clear(true, true, true);
        renderer.render(
          focusPipeline.blurHorizontalScene,
          backgroundCamera,
        );
        renderer.setRenderTarget(focusPipeline.blurVerticalTarget);
        renderer.clear(true, true, true);
        renderer.render(
          focusPipeline.blurVerticalScene,
          backgroundCamera,
        );

        renderer.setRenderTarget(null);
        renderer.clear(true, true, true);
        renderer.render(focusPipeline.compositeScene, backgroundCamera);
      } else {
        renderer.setRenderTarget(null);
        renderer.clear(true, true, true);
        renderer.render(
          backgroundCompositeScene,
          backgroundCamera,
        );
        if (shadowEnabled) renderer.render(shadowCompositeScene, backgroundCamera);
        renderer.clearDepth();
        renderer.render(scene, camera);
      }
      gpuTimer?.end();
      if (__LOCAL_CONTROLS__) {
        renderSamples?.add(performance.now() - gpuSubmissionStarted);
        canvas.dataset.physicsMs = clothSimulation.timings.total.toFixed(2);
        canvas.dataset.activeParticles = String(clothSimulation.activeCount);
        canvas.dataset.contacts = String(clothSimulation.contactTotal);
        canvas.dataset.renderCount = String(backgroundRenderFrame);
        canvas.dataset.frameCpuMs = (performance.now() - renderStarted).toFixed(2);
      }
      sceneDirty = false;
      if (moving || transitioning || pointerMoving || focusMoving || orientationMoving) scheduleRender();
      else {
        lastTimestamp = null; clothSimulation.resetClock();
        if (__LOCAL_CONTROLS__ && fpsRef.current) fpsRef.current.textContent = "En pausa";
      }
      // Reveal only after submitting a frame with the artwork, including a
      // newer design selected while the initial image was still loading.
      if (firstFramePending && (artworkReady || artworkImageRef.current)) {
        firstFramePending = false;
        setSceneRevealed(true);
        setIsLoading(false);
      }
    };

    scheduleRender = () => {
      if (!disposed && !document.hidden && !animationFrame && !renderer.getContext().isContextLost()) animationFrame = window.requestAnimationFrame(render);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    const canvasParent = canvas.parentElement;
    if (canvasParent) resizeObserver.observe(canvasParent);
    window.addEventListener("resize", resize);
    window.addEventListener("blur", handlePointerLeave);
    document.documentElement.addEventListener(
      "pointerleave",
      handlePointerLeave,
    );
    canvas.addEventListener("pointermove", handlePointer);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointerdown", handleCanvasPointerDown);
    canvas.addEventListener("pointerup", handleCanvasPointerUp);
    canvas.addEventListener("pointercancel", handleCanvasPointerCancel);
    canvas.addEventListener("lostpointercapture", handleCanvasPointerCancel);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    window.addEventListener("blur", cancelGrab);
    document.addEventListener("visibilitychange", handleVisibility);
    scheduleRender();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(designTransitionFrame);
      window.cancelAnimationFrame(backgroundTransitionFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", handlePointerLeave);
      document.documentElement.removeEventListener(
        "pointerleave",
        handlePointerLeave,
      );
      canvas.removeEventListener("pointermove", handlePointer);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
      canvas.removeEventListener("pointerup", handleCanvasPointerUp);
      canvas.removeEventListener(
        "pointercancel",
        handleCanvasPointerCancel,
      );
      canvas.removeEventListener("lostpointercapture", handleCanvasPointerCancel);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      window.removeEventListener("blur", cancelGrab);
      document.removeEventListener("visibilitychange", handleVisibility);
      clothSimulation.releaseGrab();
      gpuTimer?.dispose();
      invalidateSceneRef.current = () => undefined;
      physicsMaterialRef.current = () => undefined;
      cancelGrabRef.current = () => undefined;
      canvas.classList.remove("is-grab-ready", "is-grabbing");
      geometry.dispose();
      surface.physical.dispose();
      intactClothEdge.geometry.dispose();
      tornClothEdge.geometry.dispose();
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      shadowMaterial.dispose();
      shadowPostGeometry.dispose();
      shadowBlurHorizontalMaterial.dispose();
      shadowBlurVerticalMaterial.dispose();
      shadowCompositeMaterial.dispose();
      shadowMaskTarget.dispose();
      shadowBlurHorizontalTarget.dispose();
      shadowBlurVerticalTarget.dispose();
      backgroundGeometry.dispose();
      backgroundMaterial.dispose();
      backgroundCompositeGeometry.dispose();
      backgroundCompositeMaterial.dispose();
      backgroundRenderTarget.dispose();
      if (focusPipeline) {
        focusPipeline.sceneRenderTarget.dispose();
        focusPipeline.blurHorizontalTarget.dispose();
        focusPipeline.blurVerticalTarget.dispose();
        focusPipeline.geometry.dispose();
        focusPipeline.blurHorizontalMaterial.dispose();
        focusPipeline.blurVerticalMaterial.dispose();
        focusPipeline.compositeMaterial.dispose();
      }
      artworkTexture.dispose();
      previousArtworkTexture.dispose();
      renderer.dispose();
      designLoadRef.current += 1;
      if (uploadUrlRef.current) { URL.revokeObjectURL(uploadUrlRef.current); uploadUrlRef.current = null; }
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
  }, [meshQuality, usesPortraitCloth, rendererGeneration]);

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
    audioMountedRef.current = true;
    return () => {
      audioMountedRef.current = false;
      windAudioRef.current?.dispose();
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
    physicsMaterialRef.current(materialSettings.thickness, materialSettings.preset);
    uniforms.uFabricPreset.value = materialSettings.preset;
    uniforms.uTextureScale.value = materialSettings.scale;
    uniforms.uThickness.value = materialSettings.thickness;
    uniforms.uNormalStrength.value = materialSettings.normalStrength;
    uniforms.uBumpStrength.value = materialSettings.bumpStrength;
    uniforms.uRoughness.value = materialSettings.roughness;
    uniforms.uSheenIntensity.value = materialSettings.sheenIntensity;
  }, [materialSettings]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uAmbientIntensity.value = lighting.ambient;
    uniforms.uKeyIntensity.value = lighting.keyIntensity;
    uniforms.uFillIntensity.value = lighting.fillIntensity;
    uniforms.uShadowIntensity.value = lighting.shadowIntensity;
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
    drawArtworkImage(
      artworkCanvas,
      artworkImage,
      artworkScale,
      usesPortraitCloth ? MOBILE_ARTWORK_SCALE_MULTIPLIER : 1,
      usesPortraitCloth ? MOBILE_ARTWORK_VERTICAL_OFFSET : 0,
    );
    texture.needsUpdate = true;
  }, [artworkScale, usesPortraitCloth]);

  useEffect(() => {
    tearModeUpdaterRef.current(tornMode);
  }, [meshQuality, tornMode, usesPortraitCloth, rendererGeneration]);

  useEffect(() => {
    grabSettingsRef.current = grabSettings;
    clothGrabRef.current.configure(grabSettings);
  }, [grabSettings]);

  useEffect(() => {
    focusControlsRef.current = focusControls;
  }, [focusControls]);

  useEffect(() => {
    invalidateSceneRef.current();
  }, [wind, flagSize, color, materialSettings, lighting, focusControls, backgroundSettings, artworkScale, activeDesign, premiereLightsEnabled, paused, tornMode, reducedMotion, controlsOpen]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = media.matches;
      setReducedMotion(media.matches);
      if (media.matches) { pauseRef.current = true; setPaused(true); cancelGrabRef.current(); }
      invalidateSceneRef.current();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const sync = () => {
      void windAudioRef.current?.setRunning((windLayerEnabledRef.current || clothLayerEnabledRef.current) && !pauseRef.current && !document.hidden).catch(() => undefined);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [paused, windSoundEnabled, clothSoundEnabled]);

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

  const updateFocus =
    (key: Exclude<keyof FocusControls, "enabled">) =>
    (value: number) => {
      setFocusControls((current) => ({
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

  const applyMood = (mood: MoodPreset) => {
    const nextWind = { ...mood.wind };
    const nextMaterial = { ...mood.material };
    const nextLighting = { ...mood.lighting };
    const nextBackground = { ...mood.background };
    const settingsKey = activeDesign ?? "custom";

    windRef.current = nextWind;
    setWind(nextWind);
    setMaterialSettings(nextMaterial);
    setLighting(nextLighting);
    backgroundSettingsByDesignRef.current[settingsKey] = nextBackground;
    setBackgroundSettings(nextBackground);
    backgroundParametersRef.current(nextBackground);
    clothAudioRef.current = { motion: 0, impact: 0 };
    simulationResetRef.current();
    setAppliedMoodId(mood.id);
    setMoodEditorOpen(false);
  };

  const saveCurrentMood = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = moodNameDraft.trim();
    if (!name) return;

    const mood: MoodPreset = {
      id: `custom-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      name: name.slice(0, 18),
      accent: color,
      custom: true,
      wind: { ...wind },
      material: { ...materialSettings },
      lighting: { ...lighting },
      background: { ...backgroundSettings },
    };
    setCustomMoods((current) => [...current, mood]);
    setAppliedMoodId(mood.id);
    setMoodNameDraft("");
    setMoodEditorOpen(false);
  };

  const removeCustomMood = (moodId: string) => {
    setCustomMoods((current) =>
      current.filter((mood) => mood.id !== moodId),
    );
    if (activeMoodId === moodId) setAppliedMoodId(null);
  };

  const togglePause = () => {
    pauseRef.current = !pauseRef.current;
    if (pauseRef.current) cancelGrabRef.current();
    setPaused(pauseRef.current);
    invalidateSceneRef.current();
  };

  const syncAudioLayers = async (
    windEnabled: boolean,
    clothEnabled: boolean,
  ) => {
    const anyLayerEnabled = windEnabled || clothEnabled;
    try {
      if (anyLayerEnabled && !windAudioRef.current) {
        const { createWindAudio } = await import("./studio/audio");
        if (!audioMountedRef.current) return false;
        windAudioRef.current ??= createWindAudio({ windRef, windSoundRef, clothAudioRef, pauseRef, windLayerEnabledRef, clothLayerEnabledRef });
      }
      const engine = windAudioRef.current;
      if (!engine) return !anyLayerEnabled;
      await engine.setRunning((windLayerEnabledRef.current || clothLayerEnabledRef.current) && !pauseRef.current && !document.hidden);
      return true;
    } catch {
      setArtworkError("No se pudo activar el sonido. Podés reintentarlo desde Ajustes.");
      return false;
    }
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
    const loadToken = ++designLoadRef.current;
    if (uploadUrlRef.current) { URL.revokeObjectURL(uploadUrlRef.current); uploadUrlRef.current = null; }
    setArtworkError(null); setRetryDesign(null);
    // Selecting the current design is still a newer choice than a pending upload
    // or preset request. Keep the loaded artwork and cancel that older request.
    if (sourceDesignId === design.id && artworkImageRef.current) {
      setIsLoading(false);
      return;
    }
    if (webglError) {
      activeDesignRef.current = design.id;
      setActiveDesign(design.id); setColor(design.color); setArtworkName(design.label);
      return;
    }

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
      if (designLoadRef.current === loadToken) {
        setIsLoading(false); setArtworkError("No se pudo cargar el diseño. Podés reintentarlo."); setRetryDesign(design.id);
      }
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
    focusControlsRef.current = INITIAL_FOCUS;
    setFocusControls(INITIAL_FOCUS);
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
    setAppliedMoodId(
      selectedDesign.id === INITIAL_DESIGN.id ? "editorial" : null,
    );
    setMoodEditorOpen(false);
    setMoodNameDraft("");
    pauseRef.current = reducedMotionRef.current;
    clothAudioRef.current = { motion: 0, impact: 0 };
    setPaused(reducedMotionRef.current);
    simulationResetRef.current();
    applyDesign(selectedDesign);
  };

  const handleArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const loadToken = ++designLoadRef.current;
    setRetryDesign(null); setArtworkError(null);
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    uploadUrlRef.current = null;
    if (!ALLOWED_ARTWORK_TYPES.has(file.type) || file.size > MAX_ARTWORK_FILE_SIZE) {
      setIsLoading(false); setArtworkError("Usá una imagen PNG o WebP de hasta 10 MB."); return;
    }
    const fileUrl = URL.createObjectURL(file);
    uploadUrlRef.current = fileUrl;
    setIsLoading(true);
    const image = new Image();
    image.onload = async () => {
      try {
        if (loadToken !== designLoadRef.current) return;
        if (image.naturalWidth > MAX_ARTWORK_DIMENSION || image.naturalHeight > MAX_ARTWORK_DIMENSION) throw new Error("La imagen supera los 8192 px. Elegí una versión más pequeña.");
        const reduced = await resizeArtwork(image);
        if (loadToken !== designLoadRef.current) return;
        artworkImageRef.current = reduced;
        setPreviousDesign(activeDesignRef.current);
        if (previousDesignTimerRef.current !== null) window.clearTimeout(previousDesignTimerRef.current);
        previousDesignTimerRef.current = window.setTimeout(() => { setPreviousDesign(null); previousDesignTimerRef.current = null; }, 880);
        designTransitionRef.current(reduced, color, artworkScaleRef.current, 1, DEFAULT_TRANSITION_ORIGIN);
        setArtworkName(file.name); activeDesignRef.current = null; setActiveDesign(null);
        invalidateSceneRef.current();
      } catch (error) {
        if (loadToken === designLoadRef.current) setArtworkError(error instanceof Error ? error.message : "No se pudo preparar la imagen.");
      } finally {
        URL.revokeObjectURL(fileUrl);
        if (uploadUrlRef.current === fileUrl) uploadUrlRef.current = null;
        if (loadToken === designLoadRef.current) setIsLoading(false);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(fileUrl);
      if (uploadUrlRef.current === fileUrl) uploadUrlRef.current = null;
      if (loadToken === designLoadRef.current) { setIsLoading(false); setArtworkError("No se pudo leer la imagen. Probá con otro PNG o WebP."); }
    };
    image.src = fileUrl;
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
                    }
                    applyDesign(design);
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
        <div
          className={`stage-loader${isLoading || loadingPreview ? "" : " is-hidden"}`}
          role="status"
          aria-live="polite"
          aria-label="Cargando bandera"
          aria-hidden={!isLoading && !loadingPreview}
          style={
            {
              "--loader-color": color,
            } as React.CSSProperties
          }
        >
          <span className="loader-pulse" aria-hidden="true" />
        </div>
        {webglError && (
          <div className="static-scene" role="status">
            <div className="static-flag" style={{ background: color }}>
              <img src={DESIGN_PRESETS.find((design) => design.id === activeDesign)?.asset ?? INITIAL_DESIGN.asset} alt={`Bandera ${artworkName}`} />
            </div>
            <p>{webglError}</p>
            <button type="button" onClick={() => setRendererGeneration((value) => value + 1)}>Reintentar vista 3D</button>
          </div>
        )}
        <canvas
          hidden={!!webglError}
          ref={canvasRef}
          className={`flag-canvas${sceneRevealed ? " is-revealed" : ""}`}
          aria-label="Lienzo tridimensional interactivo"
        />
      </section>

      {artworkError && <div className="scene-message" role="alert">
        <span>{artworkError}</span>
        {retryDesign && <button type="button" onClick={() => {
          const design = DESIGN_PRESETS.find((entry) => entry.id === retryDesign);
          if (design) { designImageCache.delete(design.asset); activeDesignRef.current = null; applyDesign(design); }
        }}>Reintentar</button>}
        <button type="button" aria-label="Cerrar mensaje" onClick={() => setArtworkError(null)}>×</button>
      </div>}
      {__LOCAL_CONTROLS__ && (
        <div className="scene-actions" aria-label="Opciones de la escena">
          <button ref={settingsButtonRef} type="button" aria-expanded={controlsOpen} aria-controls="flag-controls" onClick={() => setControlsOpen((open) => !open)}>Ajustes</button>
        </div>
      )}

      {StudioControls && controlsOpen && <Suspense fallback={<div className="controls" role="status">Cargando ajustes…</div>}>
        <StudioControls
          {...{
            controlsOpen,
            setControlsOpen,
            settingsButtonRef,
            reset,
            moodEditorOpen,
            allMoods,
            activeMoodId,
            applyMood,
            removeCustomMood,
            setMoodEditorOpen,
            setMoodNameDraft,
            saveCurrentMood,
            moodNameDraft,
            activeControlTab,
            setActiveControlTab,
            flagSize,
            setFlagSize,
            wind,
            updateWind,
            grabSettings,
            updateGrab,
            windSoundEnabled,
            toggleWindSound,
            windSound,
            updateWindSound,
            clothSoundEnabled,
            toggleClothSound,
            meshQuality,
            setMeshQuality,
            tornMode,
            setTornMode,
            color,
            setColor,
            materialSettings,
            setMaterialSettings,
            updateMaterial,
            activeDesign,
            premiereLightsEnabled,
            setPremiereLightsEnabled,
            lighting,
            updateLighting,
            setLighting,
            backgroundSettings,
            updateBackground,
            focusControls,
            setFocusControls,
            updateFocus,
            loadingPreview,
            setLoadingPreview,
            transitionMode,
            setTransitionMode,
            artworkName,
            handleArtwork,
            artworkScale,
            updateArtworkScale,
            togglePause,
            paused,
            fpsRef,
          }}
        />
      </Suspense>}
    </main>
  );
}
