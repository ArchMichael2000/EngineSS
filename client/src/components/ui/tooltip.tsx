import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center">{children}</span>;
}

export function TooltipTrigger({ children }: { children: ReactElement; asChild?: boolean }) {
  return children;
}

export function TooltipContent({ children, className = "" }: { children: ReactNode; side?: string; className?: string }) {
  return <span className={`sr-only ${className}`}>{children}</span>;
}
