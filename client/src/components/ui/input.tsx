import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-hud-line bg-dark-bg px-3 py-2 text-sm text-foreground outline-none focus:border-neon-cyan ${className}`}
      {...props}
    />
  );
}
