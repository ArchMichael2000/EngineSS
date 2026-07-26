import type { InputHTMLAttributes } from "react";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number[];
  onValueChange?: (value: number[]) => void;
}

export function Slider({ value, onValueChange, className = "", min = 0, max = 100, step = 1, ...props }: SliderProps) {
  return (
    <input
      type="range"
      value={value[0] ?? 0}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onValueChange?.([Number(event.currentTarget.value)])}
      className={`w-full accent-cyan-300 ${className}`}
      {...props}
    />
  );
}
