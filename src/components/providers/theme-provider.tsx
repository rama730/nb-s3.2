'use client'

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes'
import { type ReactNode, createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

// Appearance types
type AccentColor = "indigo" | "purple" | "green" | "orange" | "pink" | "teal";
type Density = "compact" | "default" | "comfortable";

interface AppearanceContextValue {
    accentColor: AccentColor;
    setAccentColor: (color: AccentColor) => void;
    density: Density;
    setDensity: (density: Density) => void;
    reduceMotion: boolean;
    setReduceMotion: (reduce: boolean) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

// Storage keys
const ACCENT_STORAGE_KEY = "app-accent-color";
const DENSITY_STORAGE_KEY = "app-density";
const MOTION_STORAGE_KEY = "app-reduce-motion";

interface ThemeProviderProps {
    children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [accentColor, setAccentColorState] = useState<AccentColor>("indigo");
    const [density, setDensityState] = useState<Density>("default");
    const [reduceMotion, setReduceMotionState] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Load preferences from localStorage on mount
    useEffect(() => {
        const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null;
        const storedDensity = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
        const storedMotion = localStorage.getItem(MOTION_STORAGE_KEY);

        if (storedAccent) setAccentColorState(storedAccent);
        if (storedDensity) setDensityState(storedDensity);
        if (storedMotion) setReduceMotionState(storedMotion === "true");

        setMounted(true);
    }, []);

    // Apply appearance attributes in one DOM write batch
    useEffect(() => {
        if (!mounted) return;
        const root = document.documentElement;
        root.setAttribute("data-accent", accentColor);
        root.setAttribute("data-density", density);
        if (reduceMotion) root.setAttribute("data-reduce-motion", "true");
        else root.removeAttribute("data-reduce-motion");
    }, [accentColor, density, mounted, reduceMotion]);

    function ThemeChromeSync() {
        const { resolvedTheme } = useNextTheme();

        useEffect(() => {
            const t = resolvedTheme === "dark" ? "dark" : "light";
            const root = document.documentElement;
            root.style.colorScheme = t;

            const desired = t === "dark" ? "#0a0a0a" : "#ffffff";
            let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
            if (!meta) {
                meta = document.createElement("meta");
                meta.name = "theme-color";
                document.head.appendChild(meta);
            }
            if (meta.content !== desired) meta.content = desired;
        }, [resolvedTheme]);

        return null;
    }

    const setAccentColor = useCallback((color: AccentColor) => {
        setAccentColorState(color);
        localStorage.setItem(ACCENT_STORAGE_KEY, color);
    }, []);

    const setDensity = useCallback((newDensity: Density) => {
        setDensityState(newDensity);
        localStorage.setItem(DENSITY_STORAGE_KEY, newDensity);
    }, []);

    const setReduceMotion = useCallback((reduce: boolean) => {
        setReduceMotionState(reduce);
        localStorage.setItem(MOTION_STORAGE_KEY, String(reduce));
    }, []);

    const appearanceValue = useMemo(
        () => ({
            accentColor,
            setAccentColor,
            density,
            setDensity,
            reduceMotion,
            setReduceMotion,
        }),
        [accentColor, setAccentColor, density, setDensity, reduceMotion, setReduceMotion]
    );

    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
        >
            <ThemeChromeSync />
            <AppearanceContext.Provider value={appearanceValue}>
                {children}
            </AppearanceContext.Provider>
        </NextThemesProvider>
    )
}

// Re-export next-themes useTheme hook
export { useNextTheme as useTheme };

export function useAppearance() {
    const context = useContext(AppearanceContext);
    if (!context) {
        throw new Error("useAppearance must be used within a ThemeProvider");
    }
    return context;
}
