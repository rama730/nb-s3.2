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
        let frameId: number | null = null;
        let retryCount = 0;

        const attach = () => {
            const routeRoot = resolveRouteScrollRoot();
            if (!routeRoot && retryCount < 20) {
                retryCount += 1;
                frameId = window.requestAnimationFrame(attach);
                return;
            }

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

        return () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
            cleanup?.();
        };
    }, [pathname]);

    return hasShadow;
}
