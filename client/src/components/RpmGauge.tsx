import { useMemo } from 'react';

interface RpmGaugeProps {
  rpm: number;
  redline: number;
  maxRpm?: number;
  boost?: number;
  isPlaying: boolean;
}

export function RpmGauge({ rpm, redline, maxRpm, boost = 0, isPlaying }: RpmGaugeProps) {
  const max = maxRpm || redline + 500;
  const percentage = Math.min(1, rpm / max);
  const redlinePercentage = redline / max;
  const isRedlining = rpm >= redline * 0.95;

  const arcPath = useMemo(() => {
    const startAngle = -225;
    const endAngle = 45;
    const totalAngle = endAngle - startAngle;
    const currentAngle = startAngle + totalAngle * percentage;
    
    const cx = 150, cy = 150, r = 120;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (currentAngle * Math.PI) / 180;
    
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    
    const largeArc = totalAngle * percentage > 180 ? 1 : 0;
    
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }, [percentage]);

  const tickMarks = useMemo(() => {
    const ticks = [];
    const startAngle = -225;
    const endAngle = 45;
    const totalAngle = endAngle - startAngle;
    const cx = 150, cy = 150;
    
    for (let i = 0; i <= 10; i++) {
      const rpmValue = (max / 10) * i;
      const angle = startAngle + (totalAngle * i) / 10;
      const rad = (angle * Math.PI) / 180;
      const isRedzone = rpmValue >= redline;
      
      const innerR = i % 2 === 0 ? 100 : 108;
      const outerR = 118;
      
      const x1 = cx + innerR * Math.cos(rad);
      const y1 = cy + innerR * Math.sin(rad);
      const x2 = cx + outerR * Math.cos(rad);
      const y2 = cy + outerR * Math.sin(rad);
      
      ticks.push(
        <g key={i}>
          <line
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isRedzone ? 'oklch(0.72 0.25 330)' : 'oklch(0.50 0.02 270)'}
            strokeWidth={i % 2 === 0 ? 2 : 1}
            opacity={isRedzone ? 1 : 0.6}
          />
          {i % 2 === 0 && (
            <text
              x={cx + 85 * Math.cos(rad)}
              y={cy + 85 * Math.sin(rad)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isRedzone ? 'oklch(0.72 0.25 330)' : 'oklch(0.65 0.02 270)'}
              fontSize="11"
              fontFamily="Rajdhani, sans-serif"
              fontWeight="600"
            >
              {Math.round(rpmValue / 1000)}
            </text>
          )}
        </g>
      );
    }
    return ticks;
  }, [max, redline]);

  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 300 300" className="w-64 h-64 md:w-72 md:h-72">
        {/* Background arc */}
        <circle
          cx="150" cy="150" r="120"
          fill="none"
          stroke="oklch(0.20 0.02 270)"
          strokeWidth="8"
          strokeDasharray="565.5"
          strokeDashoffset="188.5"
          transform="rotate(-225 150 150)"
          strokeLinecap="round"
        />
        
        {/* Active RPM arc */}
        <path
          d={arcPath}
          fill="none"
          stroke={isRedlining ? 'oklch(0.72 0.25 330)' : 'oklch(0.75 0.18 195)'}
          strokeWidth="6"
          strokeLinecap="round"
          style={{
            filter: isRedlining 
              ? 'drop-shadow(0 0 8px oklch(0.72 0.25 330))' 
              : 'drop-shadow(0 0 4px oklch(0.75 0.18 195 / 0.5))',
            transition: 'stroke 100ms ease-out',
          }}
        />
        
        {/* Tick marks */}
        {tickMarks}
        
        {/* Center display */}
        <text
          x="150" y="140"
          textAnchor="middle"
          fill={isRedlining ? 'oklch(0.72 0.25 330)' : 'oklch(0.95 0.01 270)'}
          fontSize="36"
          fontFamily="Orbitron, sans-serif"
          fontWeight="700"
          style={{
            filter: isRedlining ? 'drop-shadow(0 0 6px oklch(0.72 0.25 330))' : 'none',
          }}
        >
          {isPlaying ? Math.round(rpm) : '---'}
        </text>
        <text
          x="150" y="165"
          textAnchor="middle"
          fill="oklch(0.50 0.02 270)"
          fontSize="12"
          fontFamily="Rajdhani, sans-serif"
          fontWeight="500"
        >
          RPM
        </text>
        
        {/* Boost display */}
        {boost > 0 && (
          <>
            <text
              x="150" y="195"
              textAnchor="middle"
              fill="oklch(0.75 0.18 195)"
              fontSize="18"
              fontFamily="Orbitron, sans-serif"
              fontWeight="600"
              style={{ filter: 'drop-shadow(0 0 4px oklch(0.75 0.18 195 / 0.5))' }}
            >
              {boost.toFixed(1)} PSI
            </text>
            <text
              x="150" y="212"
              textAnchor="middle"
              fill="oklch(0.50 0.02 270)"
              fontSize="10"
              fontFamily="Rajdhani, sans-serif"
            >
              BOOST
            </text>
          </>
        )}

        {/* Redline indicator */}
        <text
          x="150" y="250"
          textAnchor="middle"
          fill="oklch(0.72 0.25 330 / 0.7)"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          REDLINE: {redline}
        </text>
      </svg>
      
      {/* Status indicator */}
      <div className={`mt-2 flex items-center gap-2 text-xs font-mono ${
        isPlaying ? 'text-neon-cyan' : 'text-muted-foreground'
      }`}>
        <div className={`w-2 h-2 rounded-full ${
          isPlaying ? 'bg-neon-cyan animate-pulse' : 'bg-muted-foreground'
        }`} />
        {isPlaying ? 'ENGINE RUNNING' : 'ENGINE OFF'}
      </div>
    </div>
  );
}
