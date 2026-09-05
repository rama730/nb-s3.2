'use client'

export function AuthAmbientCanvas() {
    return (
        <div
            className="hidden lg:flex relative overflow-hidden bg-muted/10 border-l border-border/40 items-center justify-center p-12 select-none min-h-screen"
            aria-hidden="true"
        >
            {/* Style for smooth hardware-accelerated ambient motion */}
            <style>{`
                @keyframes ambient-drift-1 {
                    0%, 100% {
                        transform: translate3d(0, 0, 0) scale(1);
                    }
                    33% {
                        transform: translate3d(40px, -45px, 0) scale(1.22);
                    }
                    66% {
                        transform: translate3d(-30px, 35px, 0) scale(0.92);
                    }
                }
                @keyframes ambient-drift-2 {
                    0%, 100% {
                        transform: translate3d(0, 0, 0) scale(1.12);
                    }
                    40% {
                        transform: translate3d(-45px, 35px, 0) scale(0.88);
                    }
                    80% {
                        transform: translate3d(30px, -25px, 0) scale(1.25);
                    }
                }
                @keyframes ambient-spread-pulse {
                    0%, 100% {
                        opacity: 0.16;
                        transform: scale(1);
                    }
                    50% {
                        opacity: 0.28;
                        transform: scale(1.15);
                    }
                }
            `}</style>

            {/* Layer 1: Base Pulsing & Spreading Center Mesh Glow */}
            <div
                className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,oklch(0.65_0.18_262/0.20),transparent_70%)] dark:bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,oklch(0.72_0.15_262/0.22),transparent_75%)]"
                style={{
                    animation: 'ambient-spread-pulse 14s ease-in-out infinite',
                    willChange: 'transform, opacity',
                }}
            />

            {/* Layer 2: Moving & Drifting Primary Ambient Orb (Top/Right to Center) */}
            <div
                className="absolute -top-16 -right-16 w-[32rem] h-[32rem] rounded-full bg-primary/20 blur-3xl pointer-events-none"
                style={{
                    animation: 'ambient-drift-1 18s ease-in-out infinite',
                    willChange: 'transform',
                }}
            />

            {/* Layer 3: Moving & Drifting Cyan Ambient Orb (Bottom/Left to Center) */}
            <div
                className="absolute -bottom-16 -left-16 w-[30rem] h-[30rem] rounded-full bg-cyan-500/15 blur-3xl pointer-events-none"
                style={{
                    animation: 'ambient-drift-2 22s ease-in-out infinite',
                    willChange: 'transform',
                }}
            />
        </div>
    )
}
