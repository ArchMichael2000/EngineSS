import { createContext, useContext, type ReactNode } from "react";

const TabsContext = createContext<{ value: string; onValueChange: (value: string) => void } | null>(null);

export function Tabs({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) {
  return <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>;
}

export function TabsList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap rounded-md ${className}`}>{children}</div>;
}

export function TabsTrigger({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  const active = ctx?.value === value;
  return (
    <button
      type="button"
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx?.onValueChange(value)}
      className={`min-w-0 rounded-md px-2 py-2 transition ${active ? "bg-neon-cyan/15 text-neon-cyan" : "text-muted-foreground hover:text-foreground"} ${className}`}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (ctx?.value !== value) return null;
  return <div className={className}>{children}</div>;
}
