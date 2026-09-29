import * as THREE from "three";
import type { WindControls, WindSoundControls, ClothAudioMetrics, WindAudioEngine } from "./config";
type Cell<T> = { current: T };
type AudioInputs = {
  windRef: Cell<WindControls>;
  windSoundRef: Cell<WindSoundControls>;
  clothAudioRef: Cell<ClothAudioMetrics>;
  pauseRef: Cell<boolean>;
  windLayerEnabledRef: Cell<boolean>;
  clothLayerEnabledRef: Cell<boolean>;
};

export function createWindAudio(inputs: AudioInputs) {
  const { windRef, windSoundRef, clothAudioRef, pauseRef, windLayerEnabledRef, clothLayerEnabledRef } = inputs;
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
      setRunning: async () => {},
      dispose: () => {},
    };

    const update = () => {
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
        cloth.impact > 0.08 && now >= engine.nextImpactAt
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
        impactSource.onended = () => {
          impactSource.disconnect(); impactBodyFilter.disconnect(); impactSnapFilter.disconnect();
          impactBodyGain.disconnect(); impactSnapGain.disconnect();
        };
        engine.lastImpactAt = now;
        engine.nextImpactAt = now + 0.24 + Math.random() * 0.38;
      }
      clothAudioRef.current.impact *= 0.22;
      panner.pan.setTargetAtTime(
        Math.sin(elapsed * 0.23 + mediumDrift) * gustiness * 0.12,
        now,
        0.18,
      );
    };
    let active = false;
    engine.setRunning = async (enabled: boolean) => {
      active = enabled;
      window.clearInterval(engine.updateTimer); engine.updateTimer = 0;
      if (context.state === "closed") return;
      if (!active) { masterGain.gain.value = 0; await context.suspend(); return; }
      await context.resume();
      if (!active || context.state !== "running") return;
      masterGain.gain.setTargetAtTime(.9, context.currentTime, .08);
      update();
      window.clearInterval(engine.updateTimer);
      engine.updateTimer = window.setInterval(update, 50);
    };
    engine.dispose = () => {
      active = false; window.clearInterval(engine.updateTimer); source.stop();
      void context.close();
    };
    return engine;
  }
