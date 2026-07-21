"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

function resolveRouteScrollRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-scroll-root="route"]');
}

export function useScrollShadow() {
    const pathname = usePathname();
    const [hasShadow, setHasShadow] = useState(false);

    useEffect(() => {
        let cleanup: (() => void) | null = null;

        const attach = () => {
            cleanup?.();
            const routeRoot = resolveRouteScrollRoot();
            const target: HTMLElement | Window = routeRoot ?? window;
            const handler = () => {
                const scrolled = routeRoot ? routeRoot.scrollTop > 0 : window.scrollY > 0;
                setHasShadow(scrolled);
            };

            target.addEventListener("scroll", handler, { passive: true });
            handler();

            cleanup = () => {
                target.removeEventListener("scroll", handler as EventListener);
            };
        };

        attach();
        window.addEventListener("route-scroll-root-ready", attach);

        return () => {
            window.removeEventListener("route-scroll-root-ready", attach);
            cleanup?.();
        };
    }, [pathname]);

    return hasShadow;
}
