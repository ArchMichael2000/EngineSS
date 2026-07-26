import type { InputHTMLAttributes } from "react";

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Switch({ checked, onCheckedChange, className = "", ...props }: SwitchProps) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      className={`h-5 w-10 accent-fuchsia-500 ${className}`}
      {...props}
    />
  );
}
