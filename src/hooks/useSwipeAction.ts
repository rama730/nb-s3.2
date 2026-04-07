'use client';

import { useCallback, useRef, useState } from 'react';

const REVEAL_THRESHOLD = 80;

interface SwipeState {
    offsetX: number;
    isRevealed: boolean;
}

export function useSwipeAction() {
    const [state, setState] = useState<SwipeState>({ offsetX: 0, isRevealed: false });
    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const isSwipingRef = useRef(false);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        startXRef.current = e.touches[0].clientX;
        startYRef.current = e.touches[0].clientY;
        isSwipingRef.current = false;
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        const deltaX = startXRef.current - e.touches[0].clientX;
        const deltaY = Math.abs(startYRef.current - e.touches[0].clientY);
        if (!isSwipingRef.current && deltaY > Math.abs(deltaX)) return;
        if (Math.abs(deltaX) > 10) isSwipingRef.current = true;
        if (!isSwipingRef.current) return;
        const offset = Math.max(0, Math.min(deltaX, 220));
        setState({ offsetX: offset, isRevealed: offset >= REVEAL_THRESHOLD });
    }, []);

    const onTouchEnd = useCallback(() => {
        setState((prev) => {
            if (prev.offsetX >= REVEAL_THRESHOLD) {
                return { offsetX: 160, isRevealed: true };
            }
            return { offsetX: 0, isRevealed: false };
        });
        isSwipingRef.current = false;
    }, []);

    const close = useCallback(() => {
        setState({ offsetX: 0, isRevealed: false });
    }, []);

    return {
        ...state,
        handlers: { onTouchStart, onTouchMove, onTouchEnd },
        close,
    };
}
