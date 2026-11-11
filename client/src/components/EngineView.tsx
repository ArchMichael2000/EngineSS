import { useEffect, useMemo, useRef } from 'react';
import type { EngineSpec } from '../../../shared/ess/spec';
import type { FiringSchedule } from '../../../shared/ess/geometry';
import { articulatedState } from '../../../shared/ess/rods';

/**
 * Animated cross-section of the engine as the simulator has it: every bank axis, crank pin, rod
 * and firing angle comes from the solved firing schedule and the resolved spec, so what is drawn
 * is what is heard. Front view (looking along the crankshaft from the front, crank turning
 * clockwise), a plan of the cylinders along the crank, and the firing timeline over one cycle.
 * Shown slowed down: at speed nothing would be visible.
 */

interface EngineViewProps {
  spec: EngineSpec;
  schedule: FiringSchedule;
  rpm: number;
  running: boolean;
}

const PINK = 'oklch(0.72 0.25 330)';
const CYAN = 'oklch(0.75 0.18 195)';
const PURPLE = 'oklch(0.60 0.22 300)';
const AMBER = 'oklch(0.78 0.16 75)';
const LINE = 'oklch(0.45 0.04 270)';
const METAL = 'oklch(0.32 0.03 270)';
const TEXT = 'oklch(0.72 0.03 270)';
const DEG = Math.PI / 180;

const alpha = (color: string, a: number) => color.replace(')', ` / ${a.toFixed(3)})`);
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Stroke a chamber is on at cycle angle a (degrees after its firing TDC), and how far through it. */
function strokeAt(a: number, cycle: number): { kind: 'power' | 'exhaust' | 'intake' | 'compression'; t: number } {
  if (cycle === 360) return a < 180 ? { kind: 'power', t: a / 180 } : { kind: 'compression', t: (a - 180) / 180 };
  const q = cycle / 4;
  const k = Math.min(3, Math.floor(a / q));
  return { kind: (['power', 'exhaust', 'intake', 'compression'] as const)[k], t: (a - k * q) / q };
}

const STROKE_COLOR = { power: PINK, exhaust: AMBER, intake: CYAN, compression: PURPLE } as const;

export function EngineView({ spec, schedule, rpm, running }: EngineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ rpm, running });
  live.current = { rpm, running };

  const model = useMemo(() => {
    const cycle = schedule.intervalsDeg.reduce((a, b) => a + b, 0) || 720;
    const cyls = schedule.cylinders;
    // Crank angle at which the cylinder that fires first is at TDC: θ = cycleAngle + offset.
    const first = cyls.find((c) => c.fireAngleDeg === 0) ?? cyls[0];
    const offset = first ? first.pinAngleDeg - first.bankAxisDeg - first.fireAngleDeg : 0;
    const banks = [...new Set(cyls.map((c) => c.bank))].sort((a, b) => a - b);
    const positions = cyls.map((c) => c.positionM);
    const span = Math.max(1e-6, Math.max(...positions) - Math.min(...positions));
    return { cycle, cyls, offset, banks, span, minPos: Math.min(...positions) };
  }, [schedule]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    let last = performance.now();
    // Cycle angle of the display, degrees. Starts a little after the first firing so the view is not symmetric.
    let cycleAngle = 24;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(200, rect.width);
      height = Math.max(200, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const rotary = spec.rotary;
    const r = spec.strokeMm / 2;
    const rod = spec.rodLengthMm;
    const bore = spec.boreMm;
    const crown = bore * 0.45;
    const deck = rod + r + crown; // piston crown at TDC, from the crank centre
    const headTop = deck + bore * 0.28;
    const n = model.cyls.length;

    const drawPiston = (cx: number, cy: number, scale: number, time: number) => {
      const theta = cycleAngle + model.offset;
      // Distinct bank axes are drawn once each; cylinders sharing an axis overlap as ghosts with the
      // front-most (lowest position) solid.
      const order = model.cyls.slice().sort((a, b) => b.positionM - a.positionM);
      for (const c of order) {
        const front = !order.some((o) => o !== c && o.bank === c.bank && o.positionM < c.positionM);
        const beta = c.bankAxisDeg * DEG;
        // Front view: mirror the solver's rear-view angles left to right.
        const ux = -Math.sin(beta);
        const uy = -Math.cos(beta);
        const nx = -uy;
        const ny = ux;
        const pinAngle = (c.pinAngleDeg - theta) * DEG;
        const px = -Math.sin(pinAngle) * r;
        const py = -Math.cos(pinAngle) * r;
        const along = px * ux + py * uy;
        const across = px * nx + py * ny;
        let wrist = along + Math.sqrt(Math.max(0, rod * rod - across * across));
        // Master-and-link rods: a link rod runs from its knuckle pin on the master rod's big end.
        let rodX = px;
        let rodY = py;
        const row = c.linkRow !== undefined ? schedule.linkRows?.[c.linkRow] : undefined;
        if (row && c.linkIndex !== undefined) {
          const state = articulatedState(row, c.linkIndex, theta);
          wrist = state.distance;
          rodX = -state.knuckle[0];
          rodY = -state.knuckle[1];
        }
        const a = mod(cycleAngle - c.fireAngleDeg, model.cycle);
        const stroke = strokeAt(a, model.cycle);
        const tone = STROKE_COLOR[stroke.kind];
        const ghost = front ? 1 : 0.28;
        const P = (d: number, w: number): [number, number] => [cx + (ux * d + nx * w) * scale, cy + (uy * d + ny * w) * scale];
        const half = bore / 2;

        // Bore walls and head
        ctx.strokeStyle = alpha(LINE, 0.9 * ghost);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const bottom = Math.max(rod - r - crown * 1.4, r * 1.15);
        for (const side of [-1, 1]) {
          ctx.moveTo(...P(bottom, side * half));
          ctx.lineTo(...P(headTop, side * half));
        }
        ctx.moveTo(...P(headTop, -half));
        ctx.lineTo(...P(headTop, half));
        ctx.stroke();

        // Chamber gas, coloured by stroke; the power stroke glows and fades as it expands.
        const top = wrist + crown;
        const glow = stroke.kind === 'power' ? Math.exp(-3.2 * stroke.t) : 0;
        const fill = stroke.kind === 'power' ? 0.12 + 0.75 * glow : stroke.kind === 'compression' ? 0.08 + 0.2 * stroke.t : 0.1;
        ctx.fillStyle = alpha(tone, fill * ghost);
        ctx.beginPath();
        ctx.moveTo(...P(top, -half));
        ctx.lineTo(...P(headTop, -half));
        ctx.lineTo(...P(headTop, half));
        ctx.lineTo(...P(top, half));
        ctx.closePath();
        ctx.fill();
        if (glow > 0.05 && front) {
          const [gx, gy] = P(headTop - bore * 0.1, 0);
          const radius = bore * scale * (0.5 + 0.9 * glow);
          const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
          grad.addColorStop(0, alpha(PINK, 0.55 * glow));
          grad.addColorStop(1, alpha(PINK, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(gx, gy, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Rod
        ctx.strokeStyle = alpha(front ? TEXT : LINE, 0.85 * ghost);
        ctx.lineWidth = Math.max(1.5, bore * 0.16 * scale);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + rodX * scale, cy + rodY * scale);
        ctx.lineTo(...P(wrist, 0));
        ctx.stroke();
        if (row && c.linkIndex === 0) {
          // The master rod's big end carries the knuckle pins: a disc of their radius about the crank pin.
          ctx.fillStyle = alpha(METAL, 0.95);
          ctx.strokeStyle = alpha(TEXT, 0.7);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx + px * scale, cy + py * scale, row.knuckleRadius * 1.12 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (row) {
          ctx.fillStyle = alpha(TEXT, 0.9);
          ctx.beginPath();
          ctx.arc(cx + rodX * scale, cy + rodY * scale, Math.max(1.5, bore * 0.05 * scale), 0, Math.PI * 2);
          ctx.fill();
        }

        // Piston
        ctx.fillStyle = alpha(METAL, ghost);
        ctx.strokeStyle = alpha(tone, (0.5 + 0.5 * glow) * ghost);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(...P(top, -half));
        ctx.lineTo(...P(top, half));
        ctx.lineTo(...P(wrist - crown * 0.9, half));
        ctx.lineTo(...P(wrist - crown * 0.9, -half));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Pin on the crank
        ctx.fillStyle = alpha(front ? CYAN : LINE, ghost);
        ctx.beginPath();
        ctx.arc(cx + px * scale, cy + py * scale, Math.max(1.5, r * 0.12 * scale), 0, Math.PI * 2);
        ctx.fill();

        if (front && n <= 24) {
          const [lx, ly] = P(headTop + bore * 0.42, 0);
          ctx.fillStyle = alpha(glow > 0.05 ? PINK : TEXT, 0.9);
          ctx.font = `${Math.max(9, Math.min(13, bore * scale * 0.5))}px Orbitron, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(c.number), lx, ly);
        }
      }
      // Crank circle and centre
      ctx.strokeStyle = alpha(CYAN, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = alpha(CYAN, 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r * 0.1 * scale), 0, Math.PI * 2);
      ctx.fill();
      void time;
    };

    /** Wankel: the epitrochoid housing and each rotor, the front rotor solid. */
    const drawRotary = (cx: number, cy: number, size: number) => {
      const rs = rotary!;
      const e = rs.eccentricityMm;
      const R = rs.generatingRadiusMm;
      const scale = size / (2 * (R + e) * 1.12);
      ctx.strokeStyle = alpha(LINE, 1);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k <= 180; k++) {
        const t = (k / 180) * 2 * Math.PI;
        const x = cx + (e * Math.cos(3 * t) + R * Math.cos(t)) * scale;
        const y = cy + (e * Math.sin(3 * t) + R * Math.sin(t)) * scale;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const rotors = rs.rotors;
      for (let k = rotors - 1; k >= 0; k--) {
        // Shaft angle of this rotor; the rotor itself turns at a third of shaft speed.
        const shaft = (cycleAngle - (k * 360) / rotors) * DEG;
        const ox = cx + e * Math.cos(shaft) * scale;
        const oy = cy + e * Math.sin(shaft) * scale;
        const ghost = k === 0 ? 1 : 0.25;
        const apex = (j: number): [number, number] => {
          const a = shaft / 3 + (j * 2 * Math.PI) / 3;
          return [ox + R * Math.cos(a) * scale, oy + R * Math.sin(a) * scale];
        };
        // Rotor body: three flanks bowed outward between the apexes.
        const bow = (j: number): [number, number, number, number] => {
          const [x0, y0] = apex(j);
          const [x1, y1] = apex(j + 1);
          return [(x0 + x1) / 2 + ((x0 + x1) / 2 - ox) * 0.28, (y0 + y1) / 2 + ((y0 + y1) / 2 - oy) * 0.28, x1, y1];
        };
        ctx.fillStyle = alpha(METAL, 0.9 * ghost);
        ctx.beginPath();
        ctx.moveTo(...apex(0));
        for (let j = 0; j < 3; j++) ctx.quadraticCurveTo(...bow(j));
        ctx.closePath();
        ctx.fill();
        for (let face = 0; face < 3; face++) {
          const cyl = model.cyls[k * 3 + face];
          const a = cyl ? mod(cycleAngle - cyl.fireAngleDeg, model.cycle) : 0;
          const stroke = strokeAt(a, model.cycle);
          const glow = stroke.kind === 'power' ? Math.exp(-3.2 * stroke.t) : 0;
          const [x0, y0] = apex(face);
          const [x1, y1] = apex(face + 1);
          ctx.strokeStyle = alpha(STROKE_COLOR[stroke.kind], (0.45 + 0.55 * glow) * ghost);
          ctx.lineWidth = 2 + 3 * glow;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(...bow(face));
          ctx.stroke();
          void x1;
          void y1;
        }
        ctx.fillStyle = alpha(CYAN, 0.8 * ghost);
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = alpha(CYAN, 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    /** Cylinders along the crank, one row per bank, each lighting as it fires. */
    const drawPlan = (x0: number, y0: number, w: number, h: number) => {
      const rows = model.banks.length;
      // Columns follow each cylinder's place along the crank, so staggered banks and the X's rod
      // planes show as they are. Many single-cylinder "banks" (a radial) wrap onto a few rows, and a
      // rotary shows a row of three faces per rotor.
      const wrap = rows > 6;
      const faces = !!rotary;
      const places = [...new Set(model.cyls.map((c) => Math.round(c.positionM * 1e5)))].sort((a, b) => a - b);
      const gridRows = wrap ? Math.ceil(n / 9) : rows;
      const gridCols = wrap ? Math.min(9, n) : faces ? 3 : places.length;
      const cell = Math.min(w / Math.max(1, gridCols), h / Math.max(1, gridRows), 30);
      const radius = Math.min(cell * 0.46, (h / Math.max(1, gridRows)) * 0.46, 12);
      model.cyls.forEach((c, i) => {
        let col: number;
        let row: number;
        if (wrap) {
          col = i % 9;
          row = Math.floor(i / 9);
        } else if (faces) {
          row = model.banks.indexOf(c.bank);
          col = i % 3;
        } else {
          row = model.banks.indexOf(c.bank);
          col = places.indexOf(Math.round(c.positionM * 1e5));
        }
        const x = x0 + w / 2 + (col - (gridCols - 1) / 2) * cell;
        const y = y0 + h / 2 + (row - (gridRows - 1) / 2) * cell;
        const a = mod(cycleAngle - c.fireAngleDeg, model.cycle);
        const stroke = strokeAt(a, model.cycle);
        const glow = stroke.kind === 'power' ? Math.exp(-3.2 * stroke.t) : 0;
        ctx.fillStyle = alpha(PINK, 0.08 + 0.6 * glow);
        ctx.strokeStyle = alpha(glow > 0.05 ? PINK : LINE, 0.6 + 0.4 * glow);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (radius >= 6) {
          ctx.fillStyle = alpha(glow > 0.05 ? PINK : TEXT, 0.95);
          ctx.font = `${Math.max(8, Math.min(11, radius))}px Orbitron, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(c.number), x, y + 0.5);
        }
      });
    };

    /** One cycle laid out left to right: a tick where each cylinder fires and a cursor at "now". */
    const drawTimeline = (x0: number, y0: number, w: number) => {
      ctx.strokeStyle = alpha(LINE, 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + w, y0);
      ctx.stroke();
      for (const c of model.cyls) {
        const x = x0 + (c.fireAngleDeg / model.cycle) * w;
        const since = mod(cycleAngle - c.fireAngleDeg, model.cycle);
        const glow = Math.exp(-since / 25);
        ctx.strokeStyle = alpha(PINK, 0.45 + 0.55 * glow);
        ctx.lineWidth = 1 + 1.5 * glow;
        ctx.beginPath();
        ctx.moveTo(x, y0 - 6 - 5 * glow);
        ctx.lineTo(x, y0 + 6 + 5 * glow);
        ctx.stroke();
      }
      const cursor = x0 + (cycleAngle / model.cycle) * w;
      ctx.strokeStyle = alpha(CYAN, 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursor, y0 - 12);
      ctx.lineTo(cursor, y0 + 12);
      ctx.stroke();
      ctx.fillStyle = alpha(TEXT, 0.8);
      ctx.font = '9px Rajdhani, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('0°', x0, y0 + 14);
      ctx.textAlign = 'right';
      ctx.fillText(`${model.cycle}°`, x0 + w, y0 + 14);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { rpm: liveRpm, running: on } = live.current;
      if (on && !reduced) {
        // A readable pace that still follows the engine: 0.35 rev/s at idle to about 1.2 at the redline.
        const pace = 0.35 + 0.85 * Math.min(1, liveRpm / Math.max(1000, spec.calibration.redlineRpm));
        cycleAngle = mod(cycleAngle + pace * 360 * dt, model.cycle);
      }
      ctx.clearRect(0, 0, width, height);
      const timelineH = 40;
      const planH = Math.min(96, height * 0.2);
      const viewH = height - timelineH - planH - 8;
      const cx = width / 2;
      const cy = viewH / 2 + 2;
      if (rotary) drawRotary(cx, cy, Math.min(width, viewH) * 0.92);
      else {
        // Fit the largest extent of any bank from the crank centre.
        let ext = r * 1.2;
        for (const c of model.cyls) {
          const beta = c.bankAxisDeg * DEG;
          const reach = headTop + bore * 0.75;
          ext = Math.max(ext, Math.abs(Math.sin(beta)) * reach + Math.abs(Math.cos(beta)) * bore * 0.6, Math.abs(Math.cos(beta)) * reach + Math.abs(Math.sin(beta)) * bore * 0.6);
        }
        // Centre vertically on what is drawn: an inline or V engine reaches up, not down.
        let up = r * 1.25;
        let down = r * 1.25;
        let side = r * 1.25;
        for (const c of model.cyls) {
          const beta = c.bankAxisDeg * DEG;
          const reach = headTop + bore * 0.75;
          up = Math.max(up, Math.cos(beta) * reach + Math.abs(Math.sin(beta)) * bore * 0.5);
          down = Math.max(down, -Math.cos(beta) * reach + Math.abs(Math.sin(beta)) * bore * 0.5);
          side = Math.max(side, Math.abs(Math.sin(beta)) * reach + Math.abs(Math.cos(beta)) * bore * 0.5);
        }
        const scale = Math.min((viewH - 8) / (up + down), (width - 16) / (2 * side));
        drawPiston(cx, 4 + up * scale + (viewH - 8 - (up + down) * scale) / 2, scale, now);
        void ext;
      }
      drawPlan(12, viewH + 4, width - 24, planH);
      drawTimeline(16, height - timelineH + 14, width - 32);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [spec, model, schedule]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full h-[420px] block"
        role="img"
        aria-label={`Animated cross-section of the engine: ${model.cyls.length} ${spec.rotary ? 'rotor faces' : 'cylinders'}, firing order ${schedule.firingOrder.join(', ')}`}
      />
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-[Rajdhani] uppercase tracking-wide text-muted-foreground">
        {(model.cycle === 360 ? (['power', 'compression'] as const) : (['power', 'exhaust', 'intake', 'compression'] as const)).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: STROKE_COLOR[k] }} />
            {model.cycle === 360 && k === 'compression' ? 'scavenge + compression' : k}
          </span>
        ))}
        <span className="text-muted-foreground/70 normal-case">front view · crank turns clockwise · slowed down</span>
      </div>
    </div>
  );
}
