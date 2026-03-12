'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'

interface UsernameInputProps {
    value: string
    onChange: (value: string) => void
    fullName?: string
    disabled?: boolean
}

type UsernameAvailabilityResult = {
    ok: boolean
    status: number
    payload: {
        available?: boolean
        message?: string
        code?: string
    }
    responseText: string
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

async function requestUsernameAvailability(username: string): Promise<UsernameAvailabilityResult> {
    const normalized = sanitizeUsernameInput(username)
    if (!normalized) {
        return {
            ok: true,
            status: 200,
            payload: { available: false, message: "Username is unavailable" },
            responseText: "",
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
        let payload: UsernameAvailabilityResult["payload"] = {}
        let responseText = ''

        if (contentType.includes('application/json')) {
            try {
                payload = (await response.json()) as UsernameAvailabilityResult["payload"]
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
    })()
        .finally(() => {
            usernameCheckInFlight.delete(normalized)
        })

    usernameCheckInFlight.set(normalized, task)
    return task
}

// Generate simple suggestions from name
function generateSuggestions(fullName: string): string[] {
    if (!fullName || fullName.trim().length === 0) return []

    const name = fullName.toLowerCase().trim()
    const parts = name.split(/\s+/)
    const firstName = parts[0] || ''
    const lastName = parts[parts.length - 1] || ''

    const suggestions: string[] = []

    if (firstName.length >= 3) {
        suggestions.push(firstName.replace(/[^a-z0-9]/g, ''))
    }

    if (firstName && lastName && lastName !== firstName) {
        const combined = `${firstName}${lastName}`.replace(/[^a-z0-9]/g, '')
        if (combined.length >= 3) suggestions.push(combined.slice(0, 20))

        const underscored = `${firstName}_${lastName}`.replace(/[^a-z0-9_]/g, '')
        if (underscored.length >= 3) suggestions.push(underscored.slice(0, 20))
    }

    return suggestions.slice(0, 3)
}

export default function UsernameInput({ value, onChange, fullName, disabled }: UsernameInputProps) {
    const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'error'>('idle')
    const [message, setMessage] = useState('')
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const requestIdRef = useRef(0)
    const suggestionsRequestIdRef = useRef(0)

    // Validate on change: local validation first, then cancellable API check.
    useEffect(() => {
        if (!value) {
            setStatus('idle')
            setMessage('')
            return
        }

        // 1. Local Validation
        const result = validateUsername(value)
        if (!result.valid) {
            setStatus('invalid')
            setMessage(result.message)
            return
        }

        setStatus('checking')
        setMessage('Checking availability...')
        const requestId = requestIdRef.current + 1
        requestIdRef.current = requestId

        const timer = setTimeout(async () => {
            try {
                const { ok, status, payload, responseText } = await requestUsernameAvailability(value)
                if (requestId !== requestIdRef.current) return

                if (!ok) {
                    if (status === 429 || payload.code === 'RATE_LIMITED') {
                        setStatus('invalid')
                        setMessage('Too many checks. Please wait and try again.')
                        return
                    }
                    setStatus('error')
                    setMessage(payload.message || responseText || `HTTP ${status}`)
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
                if (status === 429 || payload.code === 'RATE_LIMITED') {
                    setMessage('Too many checks. Please wait and try again.')
                } else {
                    setMessage(payload.message || responseText || 'Username is unavailable')
                }
            } catch (error) {
                if (requestId !== requestIdRef.current) return
                setStatus('error')
                setMessage('Unable to verify username right now. Please retry.')
            }
        }, 350)

        return () => {
            clearTimeout(timer)
        }
    }, [value])

    // Generate suggestions from name (backend conflict-aware + local fallback).
    useEffect(() => {
        if (!fullName || value) {
            if (value) setShowSuggestions(false)
            return
        }

        const sourceName = fullName
        const fallback = generateSuggestions(sourceName)
        const requestId = suggestionsRequestIdRef.current + 1
        suggestionsRequestIdRef.current = requestId
        let cancelled = false

        async function loadSuggestions() {
            try {
                const { getUsernameSuggestions } = await import('@/app/actions/onboarding')
                const response = await getUsernameSuggestions(sourceName)
                if (cancelled || requestId !== suggestionsRequestIdRef.current) return
                const merged = Array.from(
                    new Set([...(response.suggestions || []), ...fallback].filter((item): item is string => typeof item === 'string'))
                ).slice(0, 5)
                setSuggestions(merged)
                setShowSuggestions(merged.length > 0)
            } catch {
                if (cancelled || requestId !== suggestionsRequestIdRef.current) return
                setSuggestions(fallback)
                setShowSuggestions(fallback.length > 0)
            }
        }

        void loadSuggestions()

        return () => {
            cancelled = true
        }
    }, [fullName, value])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = sanitizeUsernameInput(e.target.value)
        onChange(newValue)
        setShowSuggestions(false)
    }

    const selectSuggestion = (suggestion: string) => {
        onChange(suggestion)
        setShowSuggestions(false)
    }

    return (
        <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">
                Username <span className="text-red-500">*</span>
            </Label>

            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 text-sm">
                    @
                </span>
                <Input
                    id="username"
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    disabled={disabled}
                    placeholder="yourname"
                    className={cn(
                        "pl-8 pr-10 h-11 transition-all duration-200",
                        status === 'valid' && 'border-green-500 ring-1 ring-green-500/20',
                        status === 'invalid' && 'border-red-500 ring-1 ring-red-500/20'
                    )}
                    maxLength={20}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {status === 'checking' && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />}
                    {status === 'valid' && <Check className="w-4 h-4 text-green-500" />}
                    {status === 'invalid' && <X className="w-4 h-4 text-red-500" />}
                    {status === 'error' && <X className="w-4 h-4 text-amber-500" />}
                </div>
            </div>

            {/* Status Message */}
            {message && (
                <p className={cn(
                    "text-sm",
                    status === 'checking' && 'text-zinc-500 dark:text-zinc-400',
                    status === 'valid' && 'text-green-600 dark:text-green-400',
                    status === 'invalid' && 'text-red-600 dark:text-red-400',
                    status === 'error' && 'text-amber-600 dark:text-amber-400'
                )}>
                    {message}
                </p>
            )}

            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-zinc-500">Suggestions:</p>
                    <div className="flex flex-wrap gap-2">
                        {suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => selectSuggestion(suggestion)}
                                className="px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                            >
                                @{suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Character count */}
            <p className="text-xs text-zinc-400">
                {value.length}/20 characters
            </p>
        </div>
    )
}
