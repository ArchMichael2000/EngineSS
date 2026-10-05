import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number[];
  onValueChange?: (value: number[]) => void;
  /** Accent colour of the track fill and thumb. */
  tone?: "cyan" | "purple" | "pink" | "muted";
}

const TONES = {
  cyan: "oklch(0.75 0.18 195)",
  purple: "oklch(0.60 0.22 300)",
  pink: "oklch(0.72 0.25 330)",
  muted: "oklch(0.75 0.02 270)",
};

/**
 * Native range input with a large hit area. While the pointer holds the thumb it shows its own
 * value, so a parent re-rendering from live telemetry can never move the thumb out from under the
 * pointer; the parent's value takes over again on release.
 */
export function Slider({ value, onValueChange, className = "", min = 0, max = 100, step = 1, tone = "cyan", style, onPointerDown, ...props }: SliderProps) {
  const [held, setHeld] = useState<number | null>(null);
  const holding = held !== null;
  useEffect(() => {
    if (!holding) return;
    const release = () => setHeld(null);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [holding]);
  const shown = held ?? value[0] ?? 0;
  const lo = Number(min);
  const hi = Number(max);
  const fill = hi > lo ? Math.min(100, Math.max(0, ((shown - lo) / (hi - lo)) * 100)) : 0;
  return (
    <input
      type="range"
      value={shown}
      min={min}
      max={max}
      step={step}
      onPointerDown={(event) => {
        setHeld(Number(event.currentTarget.value));
        onPointerDown?.(event);
      }}
      onChange={(event) => {
        const v = Number(event.currentTarget.value);
        if (held !== null) setHeld(v);
        onValueChange?.([v]);
      }}
      className={`ess-range w-full ${className}`}
      style={{ ...style, ["--range-accent" as string]: TONES[tone], ["--range-fill" as string]: `${fill}%` }}
      {...props}
    />
  );
}
