export type ProceduralBackgroundPalette = {
  edge: string;
  colors: [string, string, string];
  seed: number;
  speed: number;
  warp: number;
  intensity: number;
};

export const CUSTOM_BACKGROUND_PALETTE: ProceduralBackgroundPalette = {
  edge: "#0b0b0c",
  colors: ["#222225", "#5f5b55", "#aaa398"],
  seed: 8.4,
  speed: 0.34,
  warp: 0.16,
  intensity: 0.05,
};

export const proceduralBackgroundVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const proceduralBackgroundCompositeFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uBackgroundTexture;

  float interleavedGradientNoise(vec2 pixel) {
    return fract(
      52.9829189 *
      fract(dot(pixel, vec2(0.06711056, 0.00583715)))
    );
  }

  void main() {
    float dither = interleavedGradientNoise(gl_FragCoord.xy) - 0.5;

    gl_FragColor = texture2D(uBackgroundTexture, vUv);
    gl_FragColor.rgb += dither * (0.6 / 255.0);
    gl_FragColor.rgb += dither * (0.25 / 255.0);
  }
`;

export const proceduralBackgroundFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec2 uBackgroundResolution;
  uniform vec2 uBackgroundPointer;
  uniform float uBackgroundTime;
  uniform float uBackgroundMotion;
  uniform float uBackgroundMix;

  uniform vec3 uBackgroundFromEdge;
  uniform vec3 uBackgroundFromA;
  uniform vec3 uBackgroundFromB;
  uniform vec3 uBackgroundFromC;
  uniform vec4 uBackgroundFromParams;

  uniform vec3 uBackgroundToEdge;
  uniform vec3 uBackgroundToA;
  uniform vec3 uBackgroundToB;
  uniform vec3 uBackgroundToC;
  uniform vec4 uBackgroundToParams;

  float backgroundDither(vec2 pixel) {
    return fract(
      52.9829189 *
      fract(dot(pixel, vec2(0.06711056, 0.00583715)))
    );
  }

  float meshBlob(vec2 point, vec2 center, vec2 radius) {
    vec2 local = (point - center) / max(radius, vec2(0.001));
    return 1.0 - smoothstep(0.08, 1.72, dot(local, local));
  }

  vec2 seededPoint(float seed, float offset) {
    return vec2(
      sin(seed * 1.73 + offset * 2.31),
      cos(seed * 1.19 + offset * 1.87)
    );
  }

  void main() {
    float transition = smoothstep(0.0, 1.0, uBackgroundMix);
    vec3 edgeColor = mix(
      uBackgroundFromEdge,
      uBackgroundToEdge,
      transition
    );
    vec3 colorA = mix(
      uBackgroundFromA,
      uBackgroundToA,
      transition
    );
    vec3 colorB = mix(
      uBackgroundFromB,
      uBackgroundToB,
      transition
    );
    vec3 colorC = mix(
      uBackgroundFromC,
      uBackgroundToC,
      transition
    );
    vec4 params = mix(
      uBackgroundFromParams,
      uBackgroundToParams,
      transition
    );

    float speed = params.x;
    float seed = params.y;
    float warpStrength = params.z;
    float intensity = params.w;
    float aspect =
      uBackgroundResolution.x / max(uBackgroundResolution.y, 1.0);
    float time = uBackgroundTime * speed * uBackgroundMotion;

    vec2 point = vUv - 0.5;
    point.x *= aspect;
    point += uBackgroundPointer * vec2(0.032, -0.024);

    vec2 warpedPoint = point;
    warpedPoint.x +=
      sin(point.y * 4.1 + seed * 1.37 + time * 0.11) *
      warpStrength *
      0.3;
    warpedPoint.y +=
      cos(point.x * 3.6 - seed * 0.91 - time * 0.09) *
      warpStrength *
      0.26;

    vec2 centerA =
      seededPoint(seed, 1.0) * vec2(0.24 * aspect, 0.22) +
      vec2(sin(time * 0.14), cos(time * 0.11)) * 0.035;
    vec2 centerB =
      seededPoint(seed, 2.0) * vec2(0.29 * aspect, 0.25) +
      vec2(cos(time * 0.09), sin(time * 0.13)) * 0.042;
    vec2 centerC =
      seededPoint(seed, 3.0) * vec2(0.31 * aspect, 0.28) +
      vec2(sin(time * 0.08), -cos(time * 0.1)) * 0.048;

    float blobA = meshBlob(
      warpedPoint,
      centerA,
      vec2(0.42 * max(aspect, 0.72), 0.35)
    );
    float blobB = meshBlob(
      warpedPoint,
      centerB,
      vec2(0.34 * max(aspect, 0.72), 0.29)
    );
    float blobC = meshBlob(
      warpedPoint,
      centerC,
      vec2(0.3 * max(aspect, 0.72), 0.4)
    );

    vec3 color = edgeColor;
    color = mix(color, colorA, clamp(blobA * intensity, 0.0, 0.82));
    color = mix(
      color,
      colorB,
      clamp(blobB * intensity * 0.84, 0.0, 0.72)
    );
    color = mix(
      color,
      colorC,
      clamp(blobC * intensity * 0.66, 0.0, 0.58)
    );

    float organicTexture =
      0.5 +
      sin(
        warpedPoint.x * 7.4 +
        warpedPoint.y * 5.8 +
        seed +
        time * 0.024
      ) *
      0.25 +
      sin(
        warpedPoint.y * 9.1 -
        warpedPoint.x * 4.7 -
        seed * 0.73 -
        time * 0.018
      ) *
      0.25;
    color +=
      (colorC - edgeColor) *
      (organicTexture - 0.5) *
      0.075 *
      intensity;

    vec2 vignettePoint = point * vec2(0.82, 1.0);
    float radialVignette = 1.0 - smoothstep(
      0.03,
      0.88,
      dot(vignettePoint, vignettePoint)
    );
    color *= mix(0.82, 1.035, radialVignette);

    float topEdge = 1.0 - smoothstep(0.0, 0.18, vUv.y);
    float bottomEdge = smoothstep(0.72, 1.0, vUv.y);
    float browserEdge = max(topEdge, bottomEdge);
    color = mix(color, edgeColor, browserEdge);

    float dither = backgroundDither(gl_FragCoord.xy) - 0.5;
    color += dither * (1.0 / 255.0);

    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  }
`;
