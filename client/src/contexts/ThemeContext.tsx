import { createContext, useEffect, useMemo, type ReactNode } from "react";

type Theme = "dark" | "light";

export const ThemeContext = createContext<{ theme: Theme }>({ theme: "dark" });

export function ThemeProvider({ defaultTheme = "dark", children }: { defaultTheme?: Theme; children: ReactNode }) {
  const value = useMemo(() => ({ theme: defaultTheme }), [defaultTheme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", defaultTheme === "dark");
  }, [defaultTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
