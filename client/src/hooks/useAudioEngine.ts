import { useState, useCallback, useRef, useEffect } from 'react';
import { AUDIO_ENGINE_MODEL_VERSION, getAudioEngine, AudioEngine } from '@/lib/audioEngine';
import type { EngineConfiguration, ListenerPerspective, PlaybackState } from '../../../shared/engineTypes';
import type { DriveMode, StemGains } from '../../../shared/ess/engine';
import { CURRENT_SOUND_PROFILE, DEFAULT_ENGINE_CONFIG } from '../../../shared/engineTypes';

/** How often telemetry-driven numbers on screen may change. */
const DISPLAY_HZ = 8;

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    rpm: 800,
    throttle: 0,
    load: 0.1,
    targetRpm: 800,
    boost: 0,
  });
  const [config, setConfig] = useState<EngineConfiguration>(DEFAULT_ENGINE_CONFIG);
  const animFrameRef = useRef<number | null>(null);

  const ensureEngine = useCallback(() => {
    const engine = getAudioEngine();
    engineRef.current = engine;
    return engine;
  }, []);

  useEffect(() => {
    ensureEngine();
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [ensureEngine]);

  const startStatePolling = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // Telemetry arrives ~23 times a second and the crank speed swings within every cycle, so the
    // display shows smoothed values (rpm over ~0.25 s, the rest over ~0.4 s), commits at most
    // DISPLAY_HZ times a second, and holds a limiter/fuel-cut/pops flag for at least a second.
    // Control changes (throttle, load, mode, start/stop) still show at once.
    let lastControls = '';
    let lastShown = '';
    let lastCommit = 0;
    let lastFrame = 0;
    let rpm = -1;
    let boost = 0;
    let smooth: Record<string, number> = {};
    const held = { limiter: 0, fuelCut: 0, afterfire: 0, afterfireCount: 0 };
    const poll = (now: number) => {
      const engine = ensureEngine();
      if (engine) {
        const state = engine.getState();
        const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
        lastFrame = now;
        const a = (tau: number) => 1 - Math.exp(-dt / tau);
        rpm = rpm < 0 || !state.isPlaying ? state.rpm : rpm + (state.rpm - rpm) * a(0.25);
        boost += (state.boost - boost) * a(0.4);
        let telemetry = state.telemetry;
        if (telemetry) {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(telemetry)) {
            if (typeof v !== 'number' || k === 'gear' || k === 'knockEvents' || k === 'afterfire') continue;
            next[k] = k in smooth ? smooth[k] + (v - smooth[k]) * a(0.4) : v;
          }
          smooth = next;
          if (telemetry.limiter) held.limiter = now;
          if (telemetry.fuelCut) held.fuelCut = now;
          if (telemetry.afterfire > held.afterfireCount) held.afterfire = now;
          held.afterfireCount = telemetry.afterfire;
          telemetry = {
            ...telemetry,
            ...smooth,
            limiter: now - held.limiter < 1000,
            fuelCut: now - held.fuelCut < 1000,
            afterfire: now - held.afterfire < 1000 ? telemetry.afterfire : 0,
          } as typeof telemetry;
        }
        const controls = `${state.isPlaying}|${state.throttle}|${state.load}|${state.targetRpm}|${state.driveMode}|${telemetry?.engineState}|${telemetry?.gear}`;
        const shownRpm = Math.round(rpm / 10) * 10;
        const shown = `${shownRpm}|${boost.toFixed(1)}|${telemetry ? Object.values(smooth).map((v) => v.toPrecision(3)).join(',') : ''}|${telemetry?.limiter}|${telemetry?.fuelCut}|${telemetry?.afterfire}`;
        const due = now - lastCommit >= 1000 / DISPLAY_HZ;
        if (controls !== lastControls || (due && shown !== lastShown)) {
          lastControls = controls;
          lastShown = shown;
          lastCommit = now;
          setPlaybackState({ ...state, rpm: shownRpm, boost, telemetry });
          setIsPlaying(state.isPlaying);
        }
      }
      animFrameRef.current = requestAnimationFrame(poll);
    };
    animFrameRef.current = requestAnimationFrame(poll);
  }, [ensureEngine]);

  const stopStatePolling = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const initialize = useCallback(async () => {
    const engine = ensureEngine();
    setAudioError(null);
    await engine.initialize();
    setIsInitialized(true);
  }, [ensureEngine]);

  const startEngine = useCallback(async () => {
    const engine = ensureEngine();
    try {
      setAudioError(null);
      if (!isInitialized || engine.modelVersion !== AUDIO_ENGINE_MODEL_VERSION) {
        await initialize();
      }
      engine.setConfig(config);
      await engine.start();
      setIsPlaying(true);
      startStatePolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start audio engine.";
      setAudioError(message);
      console.warn("Audio engine failed to start", error);
    }
  }, [config, ensureEngine, initialize, isInitialized, startStatePolling]);

  const stopEngine = useCallback(() => {
    const engine = ensureEngine();
    engine.stop();
    setIsPlaying(false);
    stopStatePolling();
    setPlaybackState(prev => ({ ...prev, isPlaying: false, rpm: 0 }));
  }, [ensureEngine, stopStatePolling]);

  // Throttle and load update the UI immediately; the poll would otherwise lag a frame behind the input.
  const setThrottle = useCallback((value: number) => {
    ensureEngine().setThrottle(value);
    setPlaybackState((prev) => ({ ...prev, throttle: Math.max(0, Math.min(1, value)) }));
  }, [ensureEngine]);

  const setRPM = useCallback((value: number) => {
    ensureEngine().setRPM(value);
  }, [ensureEngine]);

  const setLoad = useCallback((value: number) => {
    ensureEngine().setLoad(value);
    setPlaybackState((prev) => ({ ...prev, load: Math.max(0, Math.min(1, value)) }));
  }, [ensureEngine]);

  const updateConfig = useCallback((newConfig: EngineConfiguration) => {
    const normalizedConfig = { ...newConfig, soundProfile: CURRENT_SOUND_PROFILE };
    setConfig(normalizedConfig);
    const engine = ensureEngine();
    if (isPlaying) {
      engine.setConfig(normalizedConfig);
    }
  }, [ensureEngine, isPlaying]);

  const setDriveMode = useCallback((mode: DriveMode) => {
    ensureEngine().setDriveMode(mode);
  }, [ensureEngine]);

  const setPerspective = useCallback((perspective: ListenerPerspective) => {
    ensureEngine().setPerspective(perspective);
    setConfig((prev) => ({ ...prev, listener: { ...prev.listener, perspective } }));
  }, [ensureEngine]);

  const setAutoLevel = useCallback((on: boolean) => {
    ensureEngine().setAutoLevel(on);
    setConfig((prev) => ({ ...prev, listener: { ...prev.listener, autoLevel: on } }));
  }, [ensureEngine]);

  const setIgnition = useCallback((on: boolean) => {
    ensureEngine().setIgnition(on);
  }, [ensureEngine]);

  const shift = useCallback((dir: 1 | -1) => {
    ensureEngine().shift(dir);
  }, [ensureEngine]);

  const [vehicleOptions, setVehicleOptionsState] = useState({ autoShift: true, launchControl: false, brake: 0 });
  const setVehicleOptions = useCallback((options: Partial<{ autoShift: boolean; launchControl: boolean; brake: number }>) => {
    ensureEngine().setVehicleOptions(options);
    setVehicleOptionsState((prev) => ({ ...prev, ...options }));
  }, [ensureEngine]);

  const setStemGains = useCallback((stems: Partial<StemGains>) => {
    ensureEngine().setStemGains(stems);
  }, [ensureEngine]);

  return {
    isPlaying,
    isInitialized,
    playbackState,
    audioError,
    config,
    startEngine,
    stopEngine,
    setThrottle,
    setRPM,
    setLoad,
    updateConfig,
    setDriveMode,
    setPerspective,
    setStemGains,
    setAutoLevel,
    shift,
    setIgnition,
    vehicleOptions,
    setVehicleOptions,
    engine: engineRef.current,
  };
}



