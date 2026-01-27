"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

// Theme types
type Theme = "light" | "dark" | "system";
type AccentColor = "indigo" | "purple" | "green" | "orange" | "pink" | "teal";
type Density = "compact" | "default" | "comfortable";

interface ThemeContextValue {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    resolvedTheme: "light" | "dark";
}

interface AppearanceContextValue {
    accentColor: AccentColor;
    setAccentColor: (color: AccentColor) => void;
    density: Density;
    setDensity: (density: Density) => void;
    reduceMotion: boolean;
    setReduceMotion: (reduce: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

// Storage keys
const THEME_STORAGE_KEY = "app-theme";
const ACCENT_STORAGE_KEY = "app-accent-color";
const DENSITY_STORAGE_KEY = "app-density";
const MOTION_STORAGE_KEY = "app-reduce-motion";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>("system");
    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
    const [accentColor, setAccentColorState] = useState<AccentColor>("indigo");
    const [density, setDensityState] = useState<Density>("default");
    const [reduceMotion, setReduceMotionState] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Load preferences from localStorage on mount
    useEffect(() => {
        const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
        const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null;
        const storedDensity = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
        const storedMotion = localStorage.getItem(MOTION_STORAGE_KEY);

        if (storedTheme) setThemeState(storedTheme);
        if (storedAccent) setAccentColorState(storedAccent);
        if (storedDensity) setDensityState(storedDensity);
        if (storedMotion) setReduceMotionState(storedMotion === "true");

        setMounted(true);
    }, []);

    // Resolve system theme
    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const resolveTheme = () => {
            if (theme === "system") {
                setResolvedTheme(mediaQuery.matches ? "dark" : "light");
            } else {
                setResolvedTheme(theme);
            }
        };

        resolveTheme();
        mediaQuery.addEventListener("change", resolveTheme);

        return () => mediaQuery.removeEventListener("change", resolveTheme);
    }, [theme]);

    // Apply theme class to document
    useEffect(() => {
        if (!mounted) return;

        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(resolvedTheme);
    }, [resolvedTheme, mounted]);

    // Apply accent color CSS variable
    useEffect(() => {
        if (!mounted) return;

        const root = document.documentElement;
        root.setAttribute("data-accent", accentColor);
    }, [accentColor, mounted]);

    // Apply density CSS variable
    useEffect(() => {
        if (!mounted) return;

        const root = document.documentElement;
        root.setAttribute("data-density", density);
    }, [density, mounted]);

    // Apply reduce motion
    useEffect(() => {
        if (!mounted) return;

        const root = document.documentElement;
        if (reduceMotion) {
            root.setAttribute("data-reduce-motion", "true");
        } else {
            root.removeAttribute("data-reduce-motion");
        }
    }, [reduceMotion, mounted]);

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    }, []);

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

    const themeValue = useMemo(
        () => ({ theme, setTheme, resolvedTheme }),
        [theme, setTheme, resolvedTheme]
    );

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
        <ThemeContext.Provider value={themeValue}>
            <AppearanceContext.Provider value={appearanceValue}>
                {children}
            </AppearanceContext.Provider>
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}

export function useAppearance() {
    const context = useContext(AppearanceContext);
    if (!context) {
        throw new Error("useAppearance must be used within a ThemeProvider");
    }
    return context;
}

export default ThemeProvider;
