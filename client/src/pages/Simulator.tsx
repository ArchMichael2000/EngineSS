import { useState, useMemo, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { RpmGauge } from '@/components/RpmGauge';
import { QuickBuildPanel } from '@/components/QuickBuildPanel';
import { PlaybackController } from '@/components/PlaybackController';
import { PresetSelector } from '@/components/PresetSelector';
import { AdvancedBuildPanel } from '@/components/AdvancedBuildPanel';
import { ForcedInductionPanel } from '@/components/ForcedInductionPanel';
import { CapturePanel } from '@/components/CapturePanel';
import { ExportPanel } from '@/components/ExportPanel';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';
import { PhysicsPanel } from '@/components/PhysicsPanel';
import { ListenerPanel } from '@/components/ListenerPanel';
import { FiringChase } from '@/components/FiringChase';
import { resolveEngineSpec } from '../../../shared/ess/resolveSpec';
import { solveFiringSchedule } from '../../../shared/ess/geometry';
import { useAuth } from '@/_core/hooks/useAuth';
import { Save, Share2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { startLogin } from '@/const';

export default function Simulator() {
  const { user, isAuthenticated } = useAuth();
  const {
    isPlaying,
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
  } = useAudioEngine();
  const schedule = useMemo(() => solveFiringSchedule(resolveEngineSpec(config)), [config]);

  const [activeTab, setActiveTab] = useState('quick');
  const [showExport, setShowExport] = useState(false);
  const [configName, setConfigName] = useState('My Engine');

  // Load saved config from URL param
  const loadId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('load') ? parseInt(params.get('load')!, 10) : null;
  }, []);

  const { data: loadedConfig } = trpc.engine.getById.useQuery(
    { id: loadId! },
    { enabled: loadId !== null }
  );

  useEffect(() => {
    if (audioError) {
      toast.error(audioError);
    }
  }, [audioError]);

  useEffect(() => {
    if (loadedConfig) {
      const cfg = loadedConfig.config as any;
      if (cfg && cfg.quick) {
        updateConfig(cfg);
        setConfigName(loadedConfig.name);
      }
    }
  }, [loadedConfig]);

  const firingOrder = schedule.firingOrder;
  const cycleDeg = schedule.intervalsDeg.reduce((sum, d) => sum + d, 0) || 720;
  const cyclesPerSecond = (playbackState.rpm / 60) * (360 / cycleDeg);

  const playbackResetKey = useMemo(() => JSON.stringify({
    layout: config.quick.layout,
    cylinderCount: config.quick.cylinderCount,
    displacement: config.quick.displacement,
    crankshaft: config.quick.crankshaft,
    redline: config.quick.redline,
    aspiration: config.quick.aspiration,
    firingOrder,
    intakeType: config.advanced?.intakeType,
    exhaustRouting: config.advanced?.exhaustRouting,
    headerGeometry: config.advanced?.headerGeometry,
    turboSize: config.forcedInduction.turboSize,
    superchargerType: config.forcedInduction.superchargerType,
  }), [config, firingOrder]);

  const saveConfig = trpc.engine.save.useMutation({
    onSuccess: () => {
      toast.success('Engine configuration saved!');
    },
    onError: (err: any) => {
      toast.error('Failed to save: ' + err.message);
    },
  });

  const handleSave = () => {
    if (!isAuthenticated) {
      toast.error('Please sign in to save configurations');
      return;
    }
    saveConfig.mutate({
      name: configName,
      config: config as any,
      description: `${config.quick.cylinderCount}-cyl ${config.quick.layout} | ${config.quick.crankshaft} | ${config.quick.aspiration}`,
    });
  };

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <header className="border-b border-hud-line/30 bg-dark-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-[Orbitron] font-bold text-neon-pink glow-pink tracking-wider">
              ESS
            </h1>
            <span className="text-xs font-[Rajdhani] text-muted-foreground hidden sm:block">
              ENGINE SOUND SIMULATOR
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSave}
                  disabled={saveConfig.isPending}
                  className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-cyan/50 hover:text-neon-cyan"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowExport(true)}
                  className="text-xs font-[Rajdhani] border-hud-line hover:border-neon-pink/50 hover:text-neon-pink"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Export
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startLogin()}
                className="text-xs font-[Rajdhani] border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10"
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel - Configuration */}
          <div className="lg:col-span-4 xl:col-span-3">
            <div className="hud-panel rounded-lg p-4 space-y-4">
              <PresetSelector onSelect={updateConfig} />
              
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full bg-dark-bg/50 border border-hud-line/30">
                  <TabsTrigger
                    value="quick"
                    className="flex-1 text-xs font-[Rajdhani] uppercase data-[state=active]:bg-neon-pink/20 data-[state=active]:text-neon-pink"
                  >
                    Quick
                  </TabsTrigger>
                  <TabsTrigger
                    value="advanced"
                    className="flex-1 text-xs font-[Rajdhani] uppercase data-[state=active]:bg-neon-cyan/20 data-[state=active]:text-neon-cyan"
                  >
                    Advanced
                  </TabsTrigger>
                  <TabsTrigger
                    value="induction"
                    className="flex-1 text-xs font-[Rajdhani] uppercase data-[state=active]:bg-neon-purple/20 data-[state=active]:text-neon-purple"
                  >
                    Boost
                  </TabsTrigger>
                  <TabsTrigger
                    value="physics"
                    className="flex-1 text-xs font-[Rajdhani] uppercase data-[state=active]:bg-neon-cyan/20 data-[state=active]:text-neon-cyan"
                  >
                    Physics
                  </TabsTrigger>
                  <TabsTrigger
                    value="capture"
                    className="flex-1 text-xs font-[Rajdhani] uppercase data-[state=active]:bg-neon-cyan/20 data-[state=active]:text-neon-cyan"
                  >
                    Capture
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="quick" className="mt-4">
                  <QuickBuildPanel config={config} onChange={updateConfig} />
                </TabsContent>

                <TabsContent value="advanced" className="mt-4">
                  <AdvancedBuildPanel config={config} onChange={updateConfig} />
                </TabsContent>

                <TabsContent value="induction" className="mt-4">
                  <ForcedInductionPanel config={config} onChange={updateConfig} />
                </TabsContent>

                <TabsContent value="physics" className="mt-4">
                  <PhysicsPanel config={config} onChange={updateConfig} />
                </TabsContent>

                <TabsContent value="capture" className="mt-4">
                  <CapturePanel config={config} onApplyTuning={updateConfig} />
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Center Panel - Gauges & Visualization */}
          <div className="lg:col-span-4 xl:col-span-5 flex flex-col items-center gap-6">
            {/* Engine Summary */}
            <div className="hud-panel hud-bracket rounded-lg p-4 w-full">
              <div className="text-center space-y-1">
                <h2 className="text-sm font-[Orbitron] text-neon-cyan glow-cyan uppercase tracking-widest">
                  {config.quick.cylinderCount}-Cylinder {config.quick.layout.toUpperCase()}
                </h2>
                <p className="text-xs font-[Rajdhani] text-muted-foreground">
                  {config.quick.displacement}L | {config.quick.crankshaft} | {config.quick.exhaustCharacter} exhaust
                  {config.quick.aspiration !== 'na' && ` | ${config.quick.aspiration}`}
                </p>
              </div>
            </div>

            {/* RPM Gauge */}
            <RpmGauge
              rpm={playbackState.rpm}
              redline={config.quick.redline}
              boost={playbackState.boost}
              isPlaying={isPlaying}
            />

            {/* Firing Order Visualization */}
            <div className="hud-panel rounded-lg p-4 w-full">
              <div className="text-center">
                <h4 className="text-xs font-[Rajdhani] text-muted-foreground uppercase tracking-wide mb-2">
                  Cylinder Firing Sequence
                </h4>
                <FiringChase firingOrder={firingOrder} running={isPlaying} />
                <p className="mt-2 text-[10px] font-[Rajdhani] text-muted-foreground">
                  Firing intervals {schedule.intervalsDeg.map((d) => Math.round(d)).join(' / ')}° crank
                </p>
                {isPlaying && (
                  <p className="text-[10px] font-[Rajdhani] text-muted-foreground/80">
                    Shown slowed down: at {playbackState.rpm.toLocaleString()} rpm each cylinder fires {Math.round(cyclesPerSecond)} times a second, {Math.round(cyclesPerSecond * firingOrder.length).toLocaleString()} firings a second in all.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel - Playback Controls */}
          <div className="lg:col-span-4 xl:col-span-4">
            <div className="hud-panel rounded-lg p-4">
              <PlaybackController
                isPlaying={isPlaying}
                playbackState={playbackState}
                onStart={startEngine}
                onStop={stopEngine}
                onThrottleChange={setThrottle}
                onLoadChange={setLoad}
                onRpmChange={setRPM}
                redline={config.quick.redline}
                resetKey={playbackResetKey}
                driveMode={playbackState.driveMode ?? 'free'}
                onDriveModeChange={setDriveMode}
                onShift={shift}
                onIgnition={setIgnition}
                vehicleOptions={vehicleOptions}
                onVehicleOptions={setVehicleOptions}
              />
            </div>

            <div className="hud-panel rounded-lg p-4 mt-4">
              <ListenerPanel
                perspective={config.listener?.perspective ?? 'exterior-rear'}
                onPerspectiveChange={setPerspective}
                onStemsChange={setStemGains}
                autoLevel={config.listener?.autoLevel ?? true}
                onAutoLevelChange={setAutoLevel}
              />
            </div>

            {/* Waveform Visualization */}
            <div className="hud-panel rounded-lg p-4 mt-4">
              <h4 className="text-xs font-[Rajdhani] text-muted-foreground uppercase tracking-wide mb-3">
                Audio Waveform
              </h4>
              <WaveformVisualizer isPlaying={isPlaying} rpm={playbackState.rpm} throttle={playbackState.throttle} />
            </div>
          </div>
        </div>
      </main>

      {/* Export Modal */}
      {showExport && (
        <ExportPanel
          config={config}
          isPlaying={isPlaying}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}



