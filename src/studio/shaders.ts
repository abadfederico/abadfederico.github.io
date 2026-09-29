export const vertexShader = /* glsl */ `
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
    vec3 transformedNormal = normalMatrix * normal;
    float transformedNormalLengthSquared =
      dot(transformedNormal, transformedNormal);
    vWorldNormal =
      transformedNormalLengthSquared > 0.00000001
        ? transformedNormal * inversesqrt(transformedNormalLengthSquared)
        : vec3(0.0, 0.0, 1.0);
    vFold = position.z;
    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const fragmentShader = /* glsl */ `
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
  uniform float uDetailQuality;
  uniform float uBumpStrength;
  uniform float uRoughness;
  uniform float uSheenIntensity;
  uniform float uAmbientIntensity;
  uniform float uKeyIntensity;
  uniform float uFillIntensity;
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

  vec3 safeNormalize(vec3 value, vec3 fallback) {
    float lengthSquared = dot(value, value);
    return lengthSquared > 0.00000001
      ? value * inversesqrt(lengthSquared)
      : fallback;
  }

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
    vec3 macroNormal = safeNormalize(
      vWorldNormal,
      vec3(0.0, 0.0, 1.0)
    );
    if (!gl_FrontFacing) macroNormal *= -1.0;

    float determinant = duvdx.x * duvdy.y - duvdx.y * duvdy.x;
    float inverseDeterminant =
      abs(determinant) > 0.000001 ? 1.0 / determinant : 1.0;
    vec3 fallbackAxis =
      abs(macroNormal.y) < 0.999
        ? vec3(0.0, 1.0, 0.0)
        : vec3(1.0, 0.0, 0.0);
    vec3 fallbackTangent = safeNormalize(
      cross(fallbackAxis, macroNormal),
      vec3(1.0, 0.0, 0.0)
    );
    vec3 tangentCandidate =
      (dpdx * duvdy.y - dpdy * duvdx.y) * inverseDeterminant;
    float tangentLengthSquared = dot(tangentCandidate, tangentCandidate);
    vec3 tangent =
      tangentLengthSquared > 0.00000001
        ? tangentCandidate * inversesqrt(tangentLengthSquared)
        : fallbackTangent;
    vec3 bitangentCandidate =
      (-dpdx * duvdy.x + dpdy * duvdx.x) * inverseDeterminant;
    float bitangentLengthSquared =
      dot(bitangentCandidate, bitangentCandidate);
    vec3 bitangent =
      bitangentLengthSquared > 0.00000001
        ? bitangentCandidate * inversesqrt(bitangentLengthSquared)
        : safeNormalize(
            cross(macroNormal, tangent),
            vec3(0.0, 1.0, 0.0)
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
    vec2 heightGradient = vec2(0.0);
    if (uDetailQuality > 0.5 && detailFade > 0.05) {
      heightGradient = vec2(
        weaveHeight(vUv + vec2(texel.x, 0.0)) -
          weaveHeight(vUv - vec2(texel.x, 0.0)),
        weaveHeight(vUv + vec2(0.0, texel.y)) -
          weaveHeight(vUv - vec2(0.0, texel.y))
      ) * 0.5;
    }
    float gradientLimit =
      uFabricPreset < 0.5 ? 0.12 : 0.34;
    heightGradient *= min(
      1.0,
      gradientLimit / max(length(heightGradient), 0.0001)
    );
    vec3 normal = safeNormalize(
      macroNormal -
        tangent * heightGradient.x * uNormalStrength * detailFade * 0.58 -
        bitangent * heightGradient.y * uNormalStrength * detailFade * 0.58,
      macroNormal
    );

    vec3 keyLight = safeNormalize(
      vec3(uLightX, uLightY, uLightZ),
      vec3(0.0, 0.0, 1.0)
    );
    vec3 fillLight = safeNormalize(
      vec3(-uLightX, max(0.18, -uLightY * 0.35), uLightZ),
      vec3(0.0, 0.0, 1.0)
    );
    vec3 rimLight = safeNormalize(
      vec3(0.7, -0.2, -0.55),
      vec3(0.0, 0.0, -1.0)
    );
    float diffuse = max(dot(normal, keyLight), 0.0);
    float fillDiffuse = max(dot(normal, fillLight), 0.0);
    float rim = pow(
      clamp(1.0 - abs(normal.z), 0.0, 1.0),
      2.4
    );
    float back = max(dot(normal, rimLight), 0.0);
    vec3 viewDirection = safeNormalize(
      cameraPosition - vWorldPosition,
      vec3(0.0, 0.0, 1.0)
    );
    vec3 halfDirection = safeNormalize(
      keyLight + viewDirection,
      normal
    );
    float specularPower = mix(72.0, 11.0, uRoughness);
    float fiberAlignment = pow(
      clamp(abs(dot(tangent, halfDirection)), 0.0, 1.0),
      1.5
    );
    float anisotropicResponse = mix(0.74, 1.28, fiberAlignment);
    float specular =
      pow(
        clamp(dot(normal, halfDirection), 0.0, 1.0),
        specularPower
      ) *
      mix(0.24, 0.032, uRoughness) *
      anisotropicResponse;
    float grazingSheen =
      pow(
        clamp(1.0 - dot(normal, viewDirection), 0.0, 1.0),
        3.2
      ) *
      mix(0.075, 0.032, uRoughness) *
      mix(0.82, 1.12, fiberAlignment);
    float fiberHighlight =
      (specular + grazingSheen) * uSheenIntensity;

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
    float shadingHeight =
      uFabricPreset < 0.5 ? 0.5 : height;
    float bump =
      (shadingHeight - 0.5) * uBumpStrength * detailFade;
    fabric *= 1.0 + bump * 0.08;

    float directLighting =
      diffuse * 0.76 * uKeyIntensity +
      fillDiffuse * uFillIntensity +
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
    vec3 fiberHighlightColor = mix(uLightColor, fabric, 0.32);

    gl_FragColor = vec4(
      fabric * lighting +
      fiberHighlight * fiberHighlightColor * uKeyIntensity +
      premiereColor * premiereLighting * 0.055,
      1.0
    );
    #include <colorspace_fragment>
  }
`;

export const edgeVertexShader = /* glsl */ `
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

export const edgeFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmbientIntensity;
  uniform float uKeyIntensity;
  uniform float uFillIntensity;
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
    vec3 fillLight = normalize(
      vec3(-uLightX, max(0.18, -uLightY * 0.35), uLightZ)
    );
    float diffuse = max(dot(normal, keyLight), 0.0);
    float fillDiffuse = max(dot(normal, fillLight), 0.0);
    vec3 edgeLighting =
      vec3(max(uAmbientIntensity * 0.8, 0.0)) +
      uLightColor * (
        diffuse * 0.34 * uKeyIntensity +
        fillDiffuse * uFillIntensity * 0.24
      );
    vec3 edgeColor = uColor * max(edgeLighting, vec3(0.18));
    gl_FragColor = vec4(edgeColor, 1.0);
    #include <colorspace_fragment>
  }
`;

export const clothShadowVertexShader = /* glsl */ `
  uniform float uFlagSize;
  uniform float uTransitionScale;
  uniform float uLightX;
  uniform float uLightY;
  uniform float uShadowSpread;
  uniform float uShadowOffset;
  uniform float uShadowDepth;

  void main() {
    vec3 p = position * uFlagSize * uTransitionScale;
    p.xy *= uShadowSpread;
    vec2 castDirection = normalize(
      vec2(-uLightX, -uLightY) + vec2(0.0001)
    );
    p.xy += castDirection * uShadowOffset;
    p.z -= uShadowDepth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const clothShadowFragmentShader = /* glsl */ `
  void main() {
    gl_FragColor = vec4(1.0);
  }
`;

export const clothShadowCompositeFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uShadowTexture;
  uniform vec3 uShadowColor;
  uniform float uShadowIntensity;

  void main() {
    float mask = texture2D(uShadowTexture, vUv).a;
    float opacity = mask * uShadowIntensity * 0.5;
    gl_FragColor = vec4(uShadowColor, opacity);
  }
`;

export const focusBlurFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uTexelStep;

  void main() {
    vec4 color = texture2D(uTexture, vUv) * 0.227027;
    color += texture2D(uTexture, vUv + uTexelStep * 1.384615) * 0.316216;
    color += texture2D(uTexture, vUv - uTexelStep * 1.384615) * 0.316216;
    color += texture2D(uTexture, vUv + uTexelStep * 3.230769) * 0.070270;
    color += texture2D(uTexture, vUv - uTexelStep * 3.230769) * 0.070270;
    gl_FragColor = color;
  }
`;

export const focusCompositeFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uSharpTexture;
  uniform sampler2D uBlurredTexture;
  uniform vec2 uFocusCenter;
  uniform vec2 uResolution;
  uniform float uFocusAmount;
  uniform float uFocusRadius;
  uniform float uFocusFeather;

  void main() {
    vec4 sharp = texture2D(uSharpTexture, vUv);
    if (uFocusAmount < 0.001) {
      gl_FragColor = sharp;
      #include <colorspace_fragment>
      return;
    }

    vec4 blurred = texture2D(uBlurredTexture, vUv);
    float pointerDistance = length((vUv - uFocusCenter) * uResolution);
    float focusMask = 1.0 - smoothstep(
      uFocusRadius,
      uFocusRadius + uFocusFeather,
      pointerDistance
    );
    float sharpMix = mix(1.0, focusMask, uFocusAmount);
    gl_FragColor = mix(blurred, sharp, sharpMix);
    #include <colorspace_fragment>
  }
`;
