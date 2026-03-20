'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string
                    action?: string
                    theme?: 'light' | 'dark' | 'auto'
                    callback?: (token: string) => void
                    'expired-callback'?: () => void
                    'error-callback'?: () => void
                }
            ) => string
            remove: (widgetId: string) => void
        }
    }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || ''

export function hasTurnstileSiteKey() {
    return TURNSTILE_SITE_KEY.length > 0
}

export default function TurnstileWidget({
    action,
    onVerify,
    onExpire,
}: {
    action: string
    onVerify: (token: string) => void
    onExpire: () => void
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptReady, setScriptReady] = useState(false)

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY || !scriptReady || !containerRef.current || !window.turnstile) {
            return
        }

        if (widgetIdRef.current) {
            window.turnstile.remove(widgetIdRef.current)
            widgetIdRef.current = null
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            theme: 'auto',
            callback: onVerify,
            'expired-callback': onExpire,
            'error-callback': onExpire,
        })

        return () => {
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current)
                widgetIdRef.current = null
            }
        }
    }, [action, onExpire, onVerify, scriptReady])

    if (!TURNSTILE_SITE_KEY) return null

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
            />
            <div className="space-y-2">
                <div ref={containerRef} />
                <p className="text-xs text-muted-foreground">
                    Protected by Cloudflare Turnstile.
                </p>
            </div>
        </>
    )
}
