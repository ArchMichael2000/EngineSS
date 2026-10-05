import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X, Download, Loader2, Server, Monitor, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getAudioEngine } from '@/lib/audioEngine';
import { encodeToMp3 } from '@/lib/mp3Encoder';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import type { EngineConfiguration } from '../../../shared/engineTypes';

interface ExportPanelProps {
  config: EngineConfiguration;
  isPlaying: boolean;
  onClose: () => void;
}

export function ExportPanel({ config, isPlaying, onClose }: ExportPanelProps) {
  const { isAuthenticated } = useAuth();
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [duration, setDuration] = useState(10);
  const [normalize, setNormalize] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportMode, setExportMode] = useState<'client' | 'server'>('client');
  const [serverJobId, setServerJobId] = useState<number | null>(null);
  const [serverJobStatus, setServerJobStatus] = useState<string | null>(null);
  const [serverFileUrl, setServerFileUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const exportJobMutation = trpc.export.create.useMutation({
    onSuccess: (data) => {
      setServerJobId(data.jobId);
      setServerJobStatus('rendering');
      toast.info('Server-side render started...');
    },
    onError: (error) => {
      toast.error(`Server export failed: ${error.message}`);
      setIsExporting(false);
    },
  });

  // Poll for server job status
  const jobStatusQuery = trpc.export.status.useQuery(
    { jobId: serverJobId! },
    {
      enabled: !!serverJobId && serverJobStatus === 'rendering',
      refetchInterval: 2000,
    }
  );

  useEffect(() => {
    if (jobStatusQuery.data) {
      const job = jobStatusQuery.data;
      if (job.status === 'completed' && job.fileUrl) {
        setServerJobStatus('completed');
        setServerFileUrl(job.fileUrl);
        setIsExporting(false);
        setProgress(100);
        toast.success('Server render complete! Download ready.');
      } else if (job.status === 'failed') {
        setServerJobStatus('failed');
        setIsExporting(false);
        setProgress(0);
        toast.error(`Server render failed: ${job.errorMessage || 'Unknown error'}`);
      }
    }
  }, [jobStatusQuery.data]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleClientExport = async () => {
    setIsExporting(true);
    setProgress(0);

    try {
      const engine = getAudioEngine();
      
      setProgress(20);
      const audioBuffer = await engine.renderOffline(config, duration, {
        normalize,
        sampleRate: 44100,
      });
      
      setProgress(70);

      let blob: Blob;
      if (format === 'mp3') {
        setProgress(75);
        blob = await encodeToMp3(audioBuffer);
      } else {
        blob = engine.audioBufferToWav(audioBuffer);
      }
      
      setProgress(90);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `engine-sound-${config.quick.layout}-${config.quick.cylinderCount}cyl-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setProgress(100);
      toast.success('Export complete! File downloaded.');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  const handleServerExport = () => {
    setIsExporting(true);
    setProgress(30);
    setServerJobStatus('rendering');
    setServerFileUrl(null);
    
    exportJobMutation.mutate({
      configId: null,
      config,
      format: 'wav', // Server always renders WAV for highest quality
      duration,
    });
  };

  const handleExport = () => {
    if (exportMode === 'server' && isAuthenticated) {
      handleServerExport();
    } else {
      handleClientExport();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="hud-panel hud-bracket rounded-lg p-6 w-full max-w-md mx-4 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-[Orbitron] text-neon-pink glow-pink uppercase tracking-wider">
            Export Audio
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 hover:text-neon-pink">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Engine Summary */}
        <div className="bg-dark-bg/50 rounded p-3 border border-hud-line/20">
          <div className="text-[10px] font-[Rajdhani] text-muted-foreground uppercase">Exporting</div>
          <div className="text-sm font-[Orbitron] text-neon-cyan">
            {config.quick.cylinderCount}-Cyl {config.quick.layout.toUpperCase()} | {config.quick.crankshaft}
          </div>
        </div>

        {/* Export Mode */}
        {isAuthenticated && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Render Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExportMode('client')}
                className={`flex items-center gap-2 p-2.5 rounded border text-xs font-[Rajdhani] transition-all ${
                  exportMode === 'client'
                    ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                    : 'border-hud-line/30 text-muted-foreground hover:border-hud-line/60'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <div className="text-left">
                  <div className="font-medium">Client</div>
                  <div className="text-[9px] opacity-60">In-browser render</div>
                </div>
              </button>
              <button
                onClick={() => setExportMode('server')}
                className={`flex items-center gap-2 p-2.5 rounded border text-xs font-[Rajdhani] transition-all ${
                  exportMode === 'server'
                    ? 'border-neon-pink bg-neon-pink/10 text-neon-pink'
                    : 'border-hud-line/30 text-muted-foreground hover:border-hud-line/60'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <div className="text-left">
                  <div className="font-medium">Server</div>
                  <div className="text-[9px] opacity-60">High-fidelity</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Format (client mode only) */}
        {exportMode === 'client' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Format</label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'wav' | 'mp3')}>
              <SelectTrigger className="h-9 bg-dark-surface border-hud-line text-foreground font-[Rajdhani] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-dark-elevated border-hud-line">
                <SelectItem value="wav">WAV (Uncompressed, High Quality)</SelectItem>
                <SelectItem value="mp3">MP3 (Compressed)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Server mode info */}
        {exportMode === 'server' && (
          <div className="bg-neon-pink/5 border border-neon-pink/20 rounded p-3">
            <p className="text-[10px] font-[Rajdhani] text-foreground/70">
              Server-side rendering produces high-fidelity WAV audio with full engine simulation.
              The file will be stored and available for download once rendering completes.
            </p>
          </div>
        )}

        {/* Duration */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Duration</label>
            <span className="text-xs font-[Orbitron] text-neon-cyan">{duration}s</span>
          </div>
          <Slider
            value={[duration]}
            onValueChange={([v]) => setDuration(v)}
            min={3}
            max={exportMode === 'server' ? 120 : 60}
            step={1}
            tone="cyan"
          />
          <p className="text-[10px] text-muted-foreground font-[Rajdhani]">
            {exportMode === 'server' ? 'Up to 2 minutes for server render' : 'Renders an RPM sweep from idle to redline and back'}
          </p>
        </div>

        {/* Normalize */}
        <div className="flex items-center justify-between py-2">
          <div>
            <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">Normalize</Label>
            <p className="text-[10px] text-muted-foreground font-[Rajdhani]">Maximize volume without clipping</p>
          </div>
          <Switch
            checked={normalize}
            onCheckedChange={setNormalize}
            className="data-[state=checked]:bg-neon-cyan"
          />
        </div>

        {/* Progress */}
        {isExporting && (
          <div className="space-y-2">
            <div className="h-2 bg-dark-bg rounded-full overflow-hidden border border-hud-line/30">
              <div
                className="h-full bg-gradient-to-r from-neon-pink to-neon-cyan transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-center text-muted-foreground font-[Rajdhani]">
              {exportMode === 'server' && serverJobStatus === 'rendering'
                ? 'Server is rendering your audio...'
                : `Rendering audio... ${progress}%`}
            </p>
          </div>
        )}

        {/* Server job completed - download link */}
        {serverJobStatus === 'completed' && serverFileUrl && (
          <div className="bg-neon-cyan/5 border border-neon-cyan/30 rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-neon-cyan" />
              <span className="text-xs font-[Rajdhani] text-neon-cyan font-medium">Render Complete</span>
            </div>
            <a
              href={serverFileUrl}
              download
              className="flex items-center justify-center gap-2 w-full h-9 rounded border border-neon-cyan text-neon-cyan text-xs font-[Orbitron] uppercase tracking-wider hover:bg-neon-cyan/10 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download WAV
            </a>
          </div>
        )}

        {/* Server job failed */}
        {serverJobStatus === 'failed' && (
          <div className="bg-red-500/5 border border-red-500/30 rounded p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs font-[Rajdhani] text-red-400 font-medium">Render Failed</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-[Rajdhani] mt-1">
              Try again or use client-side export instead.
            </p>
          </div>
        )}

        {/* Export Button */}
        {!serverFileUrl && (
          <Button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full h-11 font-[Orbitron] text-sm uppercase tracking-wider bg-neon-pink/20 border border-neon-pink text-neon-pink hover:bg-neon-pink/30 box-glow-pink"
            variant="outline"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {exportMode === 'server' ? 'Server Rendering...' : 'Rendering...'}
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                {exportMode === 'server' ? 'Render on Server' : `Export ${format.toUpperCase()}`}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
