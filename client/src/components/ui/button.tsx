import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "outline" | "ghost";
type ButtonSize = "sm" | "default";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-neon-cyan/20 border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/30",
  outline: "bg-transparent border border-hud-line text-foreground hover:bg-foreground/5",
  ghost: "bg-transparent border border-transparent text-foreground hover:bg-foreground/5",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 py-1.5",
  default: "min-h-10 px-4 py-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({ variant = "default", size = "default", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
