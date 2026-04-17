'use client'

import { useEffect, useRef, useState } from 'react'
import { normalizeUsername, sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'

export type UsernameAvailabilityStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'error'

type UsernameAvailabilityPayload = {
    available?: boolean
    message?: string
    code?: string
}

type UsernameAvailabilityEnvelope =
    | {
        success: true
        data?: UsernameAvailabilityPayload
        message?: string
    }
    | {
        success: false
        message?: string
        errorCode?: string
    }

export type UsernameAvailabilityResult = {
    ok: boolean
    status: number
    payload: UsernameAvailabilityPayload
    responseText: string
}

function resolveUsernameAvailabilityMessage(payload: UsernameAvailabilityPayload, responseText: string): string {
    if (payload.code === 'USERNAME_RESERVED') return 'This username is reserved'
    if (payload.code === 'USERNAME_TAKEN') return 'Username is already taken'
    return payload.message || responseText
}

const USERNAME_CHECK_TTL_MS = 20_000
const USERNAME_CHECK_CACHE_MAX = 120
const usernameCheckCache = new Map<string, { expiresAt: number; result: UsernameAvailabilityResult }>()
const usernameCheckInFlight = new Map<string, Promise<UsernameAvailabilityResult>>()

function setUsernameCheckCache(username: string, result: UsernameAvailabilityResult) {
    if (usernameCheckCache.size >= USERNAME_CHECK_CACHE_MAX) {
        const oldest = usernameCheckCache.keys().next().value
        if (oldest) usernameCheckCache.delete(oldest)
    }
    usernameCheckCache.set(username, {
        expiresAt: Date.now() + USERNAME_CHECK_TTL_MS,
        result,
    })
}

export function resetUsernameAvailabilityCache() {
    usernameCheckCache.clear()
    usernameCheckInFlight.clear()
}

export async function requestUsernameAvailability(username: string): Promise<UsernameAvailabilityResult> {
    const normalized = sanitizeUsernameInput(username)
    if (!normalized) {
        return {
            ok: true,
            status: 200,
            payload: { available: false, message: 'Username is unavailable' },
            responseText: '',
        }
    }

    const cached = usernameCheckCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result
    }

    const existing = usernameCheckInFlight.get(normalized)
    if (existing) {
        return existing
    }

    const task = (async (): Promise<UsernameAvailabilityResult> => {
        const response = await fetch(`/api/v1/onboarding/username-check?username=${encodeURIComponent(normalized)}`, {
            method: 'GET',
            cache: 'no-store',
        })
        const responseForText = response.clone()
        const contentType = response.headers.get('content-type') || ''
        let payload: UsernameAvailabilityPayload = {}
        let responseText = ''

        if (contentType.includes('application/json')) {
            try {
                const body = (await response.json()) as UsernameAvailabilityEnvelope
                if (body && typeof body === 'object' && 'success' in body) {
                    if (body.success) {
                        payload = body.data ?? {}
                        if (!payload.message && typeof body.message === 'string') {
                            payload.message = body.message
                        }
                    } else {
                        payload = {
                            message: typeof body.message === 'string' ? body.message : undefined,
                            code: typeof body.errorCode === 'string' ? body.errorCode : undefined,
                        }
                    }
                } else {
                    payload = body as UsernameAvailabilityPayload
                }
            } catch {
                payload = {}
            }
        }

        if (!payload.message) {
            try {
                responseText = (await responseForText.text()).trim()
            } catch {
                responseText = ''
            }
        }

        const result: UsernameAvailabilityResult = {
            ok: response.ok,
            status: response.status,
            payload,
            responseText,
        }

        if (response.status < 500) {
            setUsernameCheckCache(normalized, result)
        }

        return result
    })().finally(() => {
        usernameCheckInFlight.delete(normalized)
    })

    usernameCheckInFlight.set(normalized, task)
    return task
}

export function useUsernameAvailability(params: {
    value: string
    currentUsername?: string | null
    debounceMs?: number
    enabled?: boolean
}) {
    const { value, currentUsername, debounceMs = 350, enabled = true } = params
    const [status, setStatus] = useState<UsernameAvailabilityStatus>('idle')
    const [message, setMessage] = useState('')
    const requestIdRef = useRef(0)

    useEffect(() => {
        if (!enabled) {
            setStatus('idle')
            setMessage('')
            return
        }

        if (!value) {
            setStatus('idle')
            setMessage('')
            return
        }

        const normalizedValue = normalizeUsername(value)
        const normalizedCurrent = normalizeUsername(currentUsername || '')
        if (normalizedCurrent && normalizedValue === normalizedCurrent) {
            setStatus('idle')
            setMessage('')
            return
        }

        const validation = validateUsername(normalizedValue)
        if (!validation.valid) {
            setStatus('invalid')
            setMessage(validation.message)
            return
        }

        setStatus('checking')
        setMessage('Checking availability...')
        const requestId = requestIdRef.current + 1
        requestIdRef.current = requestId

        const timer = window.setTimeout(async () => {
            try {
                const { ok, status: responseStatus, payload, responseText } = await requestUsernameAvailability(normalizedValue)
                if (requestId !== requestIdRef.current) return

                if (!ok) {
                    if (responseStatus === 429 || payload.code === 'RATE_LIMITED') {
                        setStatus('invalid')
                        setMessage('Too many checks. Please wait and try again.')
                        return
                    }
                    setStatus('error')
                    setMessage(resolveUsernameAvailabilityMessage(payload, responseText) || `HTTP ${responseStatus}`)
                    return
                }

                if (payload.available) {
                    setStatus('valid')
                    setMessage('Username is available')
                    return
                }

                if (typeof payload.available !== 'boolean') {
                    setStatus('error')
                    setMessage(payload.message || responseText || 'Unable to verify username right now. Please retry.')
                    return
                }

                setStatus('invalid')
                setMessage(resolveUsernameAvailabilityMessage(payload, responseText) || 'Username is unavailable')
            } catch {
                if (requestId !== requestIdRef.current) return
                setStatus('error')
                setMessage('Unable to verify username right now. Please retry.')
            }
        }, debounceMs)

        return () => {
            window.clearTimeout(timer)
        }
    }, [currentUsername, debounceMs, enabled, value])

    return { status, message }
}
