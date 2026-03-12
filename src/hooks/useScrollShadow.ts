"use client";

import { useState, useEffect } from "react";

function resolveRouteScrollRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-scroll-root="route"]');
}

export function useScrollShadow() {
    const [hasShadow, setHasShadow] = useState(false);

    useEffect(() => {
        let cleanup: (() => void) | null = null;
        let currentRoot: HTMLElement | null = null;

        const attach = () => {
            const routeRoot = resolveRouteScrollRoot();
            currentRoot = routeRoot;
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

        const observer = new MutationObserver(() => {
            const nextRoot = resolveRouteScrollRoot();
            if (nextRoot !== currentRoot) {
                cleanup?.();
                attach();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-scroll-root"],
        });

        return () => {
            observer.disconnect();
            cleanup?.();
        };
    }, []);

    return hasShadow;
}
