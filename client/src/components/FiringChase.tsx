import { useEffect, useState } from 'react';

/** Steps through the firing order at a readable pace (the real rate is far beyond what eyes can follow). */
const STEPS_PER_SECOND = 3;

export function FiringChase({ firingOrder, running }: { firingOrder: number[]; running: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setStep((s) => s + 1), 1000 / STEPS_PER_SECOND);
    return () => window.clearInterval(id);
  }, [running]);
  const active = running && firingOrder.length ? step % firingOrder.length : -1;
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap">
      {firingOrder.map((cyl, i) => (
        <div
          key={i}
          className={`w-8 h-8 rounded flex items-center justify-center text-xs font-[Orbitron] font-bold border transition-colors duration-150 ${
            i === active ? 'border-neon-pink bg-neon-pink/20 text-neon-pink box-glow-pink' : 'border-hud-line/40 text-muted-foreground'
          }`}
        >
          {cyl}
        </div>
      ))}
    </div>
  );
}
