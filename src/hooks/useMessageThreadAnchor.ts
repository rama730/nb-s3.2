'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroupedVirtuosoHandle } from 'react-virtuoso';
import type { MessageWithSender } from '@/app/actions/messaging';

export type MessageThreadAnchorMode = 'latest' | 'manual' | 'focused';
export type MessageScrollIntentDirection = 'up' | 'down';

export interface MessageThreadAnchorState {
    mode: MessageThreadAnchorMode;
    followBottom: boolean;
    isAtLatest: boolean;
    unreadBelow: number;
}

interface UseMessageThreadAnchorOptions {
    conversationId: string;
    /**
     * Zero-based index of the rendered latest item inside the current data
     * array. The hook converts it to Virtuoso's absolute index using
     * firstItemIndex.
     */
    bottomIndex: number;
    hasFocusTarget: boolean;
}

interface LatestMessageChangeOptions {
    latestMessage: MessageWithSender | null;
    viewerId: string | null;
}

const START_INDEX = 1_000_000;

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createMessageThreadAnchorState(hasFocusTarget: boolean): MessageThreadAnchorState {
    return {
        mode: hasFocusTarget ? 'focused' : 'latest',
        followBottom: !hasFocusTarget,
        isAtLatest: !hasFocusTarget,
        unreadBelow: 0,
    };
}

function areAnchorStatesEqual(left: MessageThreadAnchorState, right: MessageThreadAnchorState) {
    return left.mode === right.mode
        && left.followBottom === right.followBottom
        && left.isAtLatest === right.isAtLatest
        && left.unreadBelow === right.unreadBelow;
}

export function reduceAtBottomChange(
    state: MessageThreadAnchorState,
    atBottom: boolean,
    latestItemVisible = false,
): MessageThreadAnchorState {
    if (atBottom) {
        return {
            mode: 'latest',
            followBottom: true,
            isAtLatest: true,
            unreadBelow: 0,
        };
    }

    // A virtualized list can temporarily report "not at bottom" while row
    // heights, composer chrome, or parent popup layout settle. Sticky-follow is
    // disabled only by explicit upward navigation, so raw pixel loss alone
    // should not make an opened conversation look stale.
    if (state.followBottom || latestItemVisible) {
        return state;
    }

    // Sticky-follow itself is disabled only by explicit upward user intent or
    // focus jumps. This state only controls whether the jump affordance appears.
    return {
        ...state,
        isAtLatest: false,
    };
}

export function reduceUserScrollIntent(
    state: MessageThreadAnchorState,
    direction: MessageScrollIntentDirection,
): MessageThreadAnchorState {
    if (direction !== 'up') {
        return state;
    }

    return {
        ...state,
        mode: 'manual',
        followBottom: false,
        isAtLatest: false,
    };
}

export function reduceEnterFocusedMode(state: MessageThreadAnchorState): MessageThreadAnchorState {
    return {
        ...state,
        mode: 'focused',
        followBottom: false,
        isAtLatest: false,
    };
}

export function reduceScrollToLatest(): MessageThreadAnchorState {
    return {
        mode: 'latest',
        followBottom: true,
        isAtLatest: true,
        unreadBelow: 0,
    };
}

export function shouldLoadOlderMessages(state: MessageThreadAnchorState): boolean {
    return state.mode === 'manual' || state.mode === 'focused';
}

export function resolveLatestMessageTransition(params: {
    state: MessageThreadAnchorState;
    latestMessage: MessageWithSender | null;
    previousLatestMessageId: string | null;
    viewerId: string | null;
}): {
    state: MessageThreadAnchorState;
    scroll: false | 'auto' | 'smooth';
} {
    const latestMessageId = params.latestMessage?.id ?? null;
    if (!latestMessageId || params.previousLatestMessageId === latestMessageId) {
        return { state: params.state, scroll: false };
    }

    if (!params.previousLatestMessageId) {
        if (params.state.mode === 'latest' && params.state.followBottom) {
            return { state: reduceScrollToLatest(), scroll: 'auto' };
        }
        return { state: params.state, scroll: false };
    }

    if (params.viewerId && params.latestMessage?.senderId === params.viewerId) {
        return { state: reduceScrollToLatest(), scroll: 'auto' };
    }

    if (params.state.followBottom || params.state.mode === 'latest') {
        return { state: reduceScrollToLatest(), scroll: 'auto' };
    }

    return {
        state: {
            ...params.state,
            unreadBelow: params.state.unreadBelow + 1,
        },
        scroll: false,
    };
}

export function useMessageThreadAnchor({
    conversationId,
    bottomIndex,
    hasFocusTarget,
}: UseMessageThreadAnchorOptions) {
    const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null);
    const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
    const [anchorState, setAnchorState] = useState(() => createMessageThreadAnchorState(hasFocusTarget));
    const anchorStateRef = useRef(anchorState);
    const previousLatestMessageIdRef = useRef<string | null>(null);
    const latestItemVisibleRef = useRef(false);
    const pendingLatestScrollFrameRef = useRef<number | null>(null);
    const absoluteBottomIndex = bottomIndex >= 0 ? firstItemIndex + bottomIndex : -1;

    const applyAnchorState = useCallback((nextState: MessageThreadAnchorState) => {
        if (areAnchorStatesEqual(anchorStateRef.current, nextState)) {
            return;
        }
        anchorStateRef.current = nextState;
        setAnchorState(nextState);
    }, []);

    // Reset all state when the conversation changes.
    useEffect(() => {
        const nextState = createMessageThreadAnchorState(hasFocusTarget);
        setFirstItemIndex(START_INDEX);
        anchorStateRef.current = nextState;
        setAnchorState(nextState);
        previousLatestMessageIdRef.current = null;
        latestItemVisibleRef.current = false;
    }, [conversationId, hasFocusTarget]);

    useEffect(() => () => {
        if (pendingLatestScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(pendingLatestScrollFrameRef.current);
            pendingLatestScrollFrameRef.current = null;
        }
    }, []);

    const decrementFirstItemIndex = useCallback((prependedCount: number) => {
        if (prependedCount <= 0) return;
        setFirstItemIndex((current) => current - prependedCount);
    }, []);

    const scheduleLatestScroll = useCallback((
        behavior: 'auto' | 'smooth',
        attempts: number,
    ) => {
        if (absoluteBottomIndex < 0) return;
        const resolvedBehavior = prefersReducedMotion() ? 'auto' : behavior;
        const run = (remainingAttempts: number) => {
            pendingLatestScrollFrameRef.current = window.requestAnimationFrame(() => {
                pendingLatestScrollFrameRef.current = null;
                virtuosoRef.current?.scrollToIndex({
                    index: 'LAST',
                    align: 'end',
                    behavior: resolvedBehavior,
                });
                if (remainingAttempts > 1) {
                    run(remainingAttempts - 1);
                }
            });
        };
        if (pendingLatestScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(pendingLatestScrollFrameRef.current);
            pendingLatestScrollFrameRef.current = null;
        }
        run(Math.max(1, attempts));
    }, [absoluteBottomIndex]);

    const scrollToLatest = useCallback((
        behavior: 'auto' | 'smooth' = 'smooth',
        settleFrames = 1,
    ) => {
        if (absoluteBottomIndex < 0) return;
        applyAnchorState(reduceScrollToLatest());
        // Defer so Virtuoso sees state/data updates first. Extra auto frames are
        // used only for conversation open/layout settle, where parent height can
        // change after the list has mounted.
        scheduleLatestScroll(behavior, settleFrames);
    }, [absoluteBottomIndex, applyAnchorState, scheduleLatestScroll]);

    const enterFocusedMode = useCallback(() => {
        applyAnchorState(reduceEnterFocusedMode(anchorStateRef.current));
    }, [applyAnchorState]);

    const handleAtBottomChange = useCallback((atBottom: boolean) => {
        if (atBottom) {
            latestItemVisibleRef.current = true;
        }
        applyAnchorState(reduceAtBottomChange(
            anchorStateRef.current,
            atBottom,
            latestItemVisibleRef.current,
        ));
    }, [applyAnchorState]);

    const handleRange = useCallback((endIndex: number) => {
        if (absoluteBottomIndex >= 0 && endIndex >= absoluteBottomIndex) {
            latestItemVisibleRef.current = true;
            applyAnchorState(reduceAtBottomChange(anchorStateRef.current, true, true));
            return true;
        }
        latestItemVisibleRef.current = false;
        return false;
    }, [absoluteBottomIndex, applyAnchorState]);

    const handleLatestMessageChange = useCallback(({
        latestMessage,
        viewerId,
    }: LatestMessageChangeOptions) => {
        const latestMessageId = latestMessage?.id ?? null;
        const previousLatestMessageId = previousLatestMessageIdRef.current;
        previousLatestMessageIdRef.current = latestMessageId;

        const transition = resolveLatestMessageTransition({
            state: anchorStateRef.current,
            latestMessage,
            previousLatestMessageId,
            viewerId,
        });
        applyAnchorState(transition.state);
        if (transition.scroll) {
            scrollToLatest(transition.scroll);
        }
    }, [applyAnchorState, scrollToLatest]);

    const noteUserScrollIntent = useCallback((direction: MessageScrollIntentDirection) => {
        applyAnchorState(reduceUserScrollIntent(anchorStateRef.current, direction));
    }, [applyAnchorState]);

    return {
        virtuosoRef,
        firstItemIndex,
        followBottom: anchorState.followBottom,
        anchorMode: anchorState.mode,
        isAtLatest: anchorState.isAtLatest,
        unreadBelow: anchorState.unreadBelow,
        // Always ready — no opacity gate. The Virtuoso renders only when
        // messages.length > 0, so initial scroll is declarative.
        isInitialAnchorReady: true as const,
        noteUserScrollIntent,
        enterFocusedMode,
        handleAtBottomChange,
        handleLatestMessageChange,
        handleRange,
        scrollToLatest,
        canLoadOlderMessages: () => shouldLoadOlderMessages(anchorStateRef.current),
        decrementFirstItemIndex,
    };
}
