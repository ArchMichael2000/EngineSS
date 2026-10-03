import { useState, useCallback, useRef, useEffect } from 'react';
import { AUDIO_ENGINE_MODEL_VERSION, getAudioEngine, AudioEngine } from '@/lib/audioEngine';
import type { EngineConfiguration, ListenerPerspective, PlaybackState } from '../../../shared/engineTypes';
import type { DriveMode, StemGains } from '../../../shared/ess/engine';
import { DEFAULT_ENGINE_CONFIG, normalizeSoundProfile } from '../../../shared/engineTypes';

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
    const poll = () => {
      const engine = ensureEngine();
      if (engine) {
        const state = engine.getState();
        setPlaybackState(state);
        setIsPlaying(state.isPlaying);
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

  const setThrottle = useCallback((value: number) => {
    ensureEngine().setThrottle(value);
  }, [ensureEngine]);

  const setRPM = useCallback((value: number) => {
    ensureEngine().setRPM(value);
  }, [ensureEngine]);

  const setLoad = useCallback((value: number) => {
    ensureEngine().setLoad(value);
  }, [ensureEngine]);

  const updateConfig = useCallback((newConfig: EngineConfiguration) => {
    const normalizedConfig = { ...newConfig, soundProfile: normalizeSoundProfile(newConfig.soundProfile) };
    setConfig(normalizedConfig);
    const engine = ensureEngine();
    if (isPlaying) {
      engine.setConfig(normalizedConfig);
    }
  }, [ensureEngine, isPlaying]);

  const triggerBOV = useCallback(() => {
    ensureEngine().triggerBOV();
  }, [ensureEngine]);

  const setDriveMode = useCallback((mode: DriveMode) => {
    ensureEngine().setDriveMode(mode);
  }, [ensureEngine]);

  const setPerspective = useCallback((perspective: ListenerPerspective) => {
    ensureEngine().setPerspective(perspective);
    setConfig((prev) => ({ ...prev, listener: { ...prev.listener, perspective } }));
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
    triggerBOV,
    setDriveMode,
    setPerspective,
    setStemGains,
    engine: engineRef.current,
  };
}



