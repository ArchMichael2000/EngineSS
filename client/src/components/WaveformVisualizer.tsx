import { useRef, useEffect, useState } from 'react';
import { getAudioEngine } from '@/lib/audioEngine';

interface WaveformVisualizerProps {
  isPlaying: boolean;
  rpm: number;
  throttle: number;
}

export function WaveformVisualizer({ isPlaying, rpm, throttle }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const [mode, setMode] = useState<'waveform' | 'spectrum'>('waveform');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Draw grid lines
      ctx.strokeStyle = 'rgba(0, 255, 247, 0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 8; i++) {
        const y = (height / 8) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const x = (width / 16) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (!isPlaying) {
        // Draw flat line when engine is off
        ctx.strokeStyle = 'rgba(0, 255, 247, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 255, 247, 0.4)';
        ctx.font = '10px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('ENGINE OFF', width / 2, height / 2 - 10);
        
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Get real audio data from the engine's AnalyserNode
      const engine = getAudioEngine();
      const analyser = engine.getAnalyser();

      if (analyser) {
        if (mode === 'waveform') {
          // Time-domain waveform
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteTimeDomainData(dataArray);

          // Draw waveform
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00fff7';
          ctx.shadowColor = '#00fff7';
          ctx.shadowBlur = 4;
          ctx.beginPath();

          const sliceWidth = width / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }

          ctx.stroke();
          ctx.shadowBlur = 0;

          // Secondary trace (slightly delayed/offset for depth)
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(255, 0, 200, 0.4)';
          ctx.beginPath();
          x = 0;
          for (let i = 2; i < bufferLength; i++) {
            const v = dataArray[i - 2] / 128.0;
            const y = (v * height) / 2;
            if (i === 2) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }
          ctx.stroke();
        } else {
          // Frequency spectrum
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);

          const barWidth = (width / bufferLength) * 2.5;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            // Gradient from cyan to pink based on frequency
            const ratio = i / bufferLength;
            const r = Math.floor(ratio * 255);
            const g = Math.floor((1 - ratio) * 255);
            const b = 247;

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
            if (x > width) break;
          }
        }
      } else {
        // Fallback: synthetic waveform based on RPM/throttle
        ctx.strokeStyle = '#00fff7';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00fff7';
        ctx.shadowBlur = 4;
        ctx.beginPath();

        const freq = rpm / 60;
        const time = performance.now() / 1000;

        for (let x = 0; x < width; x++) {
          const t = x / width * 0.05 + time;
          const wave = Math.sin(t * freq * Math.PI * 2) * 0.3 +
                       Math.sin(t * freq * 2 * Math.PI * 2) * 0.15 * throttle +
                       Math.sin(t * freq * 0.5 * Math.PI * 2) * 0.2;
          const y = height / 2 + wave * height * 0.4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // RPM readout overlay
      ctx.fillStyle = 'rgba(0, 255, 247, 0.6)';
      ctx.font = '9px Orbitron';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(rpm)} RPM`, 8, 14);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(throttle * 100)}% THR`, width - 8, 14);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [isPlaying, rpm, throttle, mode]);

  return (
    <div className="hud-panel rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-[Orbitron] text-neon-cyan/80 uppercase tracking-wider">
          Audio {mode === 'waveform' ? 'Waveform' : 'Spectrum'}
        </h4>
        <button
          onClick={() => setMode(mode === 'waveform' ? 'spectrum' : 'waveform')}
          className="text-[9px] font-[Rajdhani] text-muted-foreground hover:text-neon-pink transition-colors uppercase tracking-wide px-2 py-0.5 border border-hud-line/30 rounded"
        >
          {mode === 'waveform' ? 'Spectrum' : 'Waveform'}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="w-full h-[120px] rounded border border-hud-line/20"
      />
    </div>
  );
}
