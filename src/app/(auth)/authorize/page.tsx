'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    Fingerprint,
    KeyRound,
    Loader2,
    Lock,
    RefreshCw,
    ShieldCheck,
    Terminal,
    X,
    XCircle,
    type LucideIcon,
} from 'lucide-react'

import { generateExtensionAuthCode } from '@/app/actions/extension-sessions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConnectionStatus = 'idle' | 'authorizing' | 'success' | 'error'
type FlowStepKey = 'authorize' | 'token' | 'return'
type StepState = 'complete' | 'active' | 'pending' | 'error' | 'blocked'

type FlowStep = {
    key: FlowStepKey
    title: string
    description: string
    icon: LucideIcon
}

const FLOW_STEPS: FlowStep[] = [
    {
        key: 'authorize',
        title: 'Authorize access',
        description: 'Confirm the signed-in account, editor, and callback destination.',
        icon: ShieldCheck,
    },
    {
        key: 'token',
        title: 'Generate device token',
        description: 'Create one revocable token for this editor session.',
        icon: KeyRound,
    },
    {
        key: 'return',
        title: 'Return to editor',
        description: 'Send the token back through the approved editor callback.',
        icon: Terminal,
    },
]

const EXTENSION_URI_AUTHORITY = 'nb-workspace.nb-vscode-sync'
const AUTH_CALLBACK_PATH = '/auth-callback'

const STEP_STATE_LABEL: Record<StepState, string> = {
    complete: 'Done',
    active: 'Active',
    pending: 'Waiting',
    error: 'Needs retry',
    blocked: 'Blocked',
}

function parseProtocol(url: string | null): string | null {
    if (!url) return null
    try {
        return new URL(url).protocol.replace(':', '').toLowerCase()
    } catch {
        const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
        return match && match[1] ? match[1].toLowerCase() : null
    }
}

function getCallbackEditorName(url: string | null): string {
    const protocol = parseProtocol(url)
    if (!protocol) return 'Editor'

    if (protocol === 'cursor') return 'Cursor'
    if (protocol === 'windsurf') return 'Windsurf'
    if (protocol === 'vscode-insiders') return 'VS Code Insiders'
    if (protocol === 'vscode') return 'VS Code'
    if (protocol === 'http') return 'Local editor bridge'

    return protocol
        .split(/[-_]+/)
        .map((word) => {
            const lower = word.toLowerCase()
            if (lower === 'ide') return 'IDE'
            if (lower === 'vs') return 'VS'
            return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')
}

function validateCallback(url: string | null): boolean {
    if (!url) return false

    try {
        const parsed = new URL(url)
        return (
            /^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(parsed.protocol)
            && parsed.hostname === EXTENSION_URI_AUTHORITY
            && parsed.pathname === AUTH_CALLBACK_PATH
        )
    } catch {
        return false
    }
}

function formatCallbackDestination(url: string | null): string {
    if (!url) return 'Missing callback'

    try {
        const parsed = new URL(url)
        const scheme = parsed.protocol.replace(':', '')
        if (parsed.hostname) return `${scheme}://${parsed.hostname}`
        return `${scheme} callback`
    } catch {
        return url.length > 44 ? `${url.slice(0, 41)}...` : url
    }
}

function buildCallbackUrl(baseUrl: string, params: Record<string, string>): string {
    try {
        const url = new URL(baseUrl)
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value)
        })
        return url.toString()
    } catch {
        const separator = baseUrl.includes('?') ? '&' : '?'
        return `${baseUrl}${separator}${new URLSearchParams(params).toString()}`
    }
}

function getStepState(
    key: FlowStepKey,
    status: ConnectionStatus,
    isValid: boolean,
): StepState {
    if (!isValid) {
        return key === 'authorize' ? 'blocked' : 'pending'
    }

    if (status === 'success') return 'complete'

    if (status === 'error') {
        if (key === 'authorize') return 'complete'
        if (key === 'token') return 'error'
        return 'pending'
    }

    if (status === 'authorizing') {
        if (key === 'authorize') return 'complete'
        if (key === 'token') return 'active'
        return 'pending'
    }

    return key === 'authorize' ? 'active' : 'pending'
}

function getStatusCopy({
    status,
    isValid,
    editorName,
    errorMsg,
}: {
    status: ConnectionStatus
    isValid: boolean
    editorName: string
    errorMsg: string | null
}) {
    if (!isValid) {
        return {
            title: 'Connection request blocked',
            description: 'The callback is missing or uses a scheme this page cannot approve.',
        }
    }

    if (status === 'authorizing') {
        return {
            title: 'Generating device token',
            description: 'Keep this tab open while the browser authorizes the editor session.',
        }
    }

    if (status === 'success') {
        return {
            title: 'Editor connected',
            description: `The token was sent back to ${editorName}. Check the editor window to finish.`,
        }
    }

    if (status === 'error') {
        return {
            title: 'Connection failed',
            description: errorMsg || 'The authorization request could not be completed.',
        }
    }

    return {
        title: 'Ready for approval',
        description: `Authorize this request to connect ${editorName} with your signed-in account.`,
    }
}

function AuthorizePageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get('callback')
    const callbackState = searchParams.get('state')
    const isValid = validateCallback(callbackUrl)
    const editorName = getCallbackEditorName(callbackUrl)
    const callbackDestination = formatCallbackDestination(callbackUrl)

    const [status, setStatus] = useState<ConnectionStatus>('idle')
    const [progressText, setProgressText] = useState('Waiting for approval')
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [debugDetails, setDebugDetails] = useState<string | null>(null)
    const [authCode, setAuthCode] = useState<string | null>(null)
    const [needsSignIn, setNeedsSignIn] = useState(false)

    const isDev = process.env.NODE_ENV !== 'production'
    const accountLabel = 'Browser session verified on approval'

    const statusCopy = useMemo(
        () => getStatusCopy({ status, isValid, editorName, errorMsg }),
        [editorName, errorMsg, isValid, status],
    )

    const redirectToEditor = (params: Record<string, string>) => {
        if (!callbackUrl || !isValid) return
        window.location.assign(buildCallbackUrl(callbackUrl, callbackState ? { ...params, state: callbackState } : params))
    }

    const handleAuthorize = async () => {
        if (!callbackUrl) {
            setStatus('error')
            setErrorMsg('Missing callback parameter.')
            return
        }

        if (!isValid) {
            setStatus('error')
            setErrorMsg('Invalid redirect callback scheme.')
            return
        }

        setStatus('authorizing')
        setErrorMsg(null)
        setDebugDetails(null)
        setProgressText('Checking browser session')

        try {
            setProgressText('Creating revocable device token')

            const res = await generateExtensionAuthCode(editorName, {
                authMethod: 'web_login',
                requestState: callbackState,
                callbackUri: callbackUrl,
            })

            if (res.success) {
                setAuthCode(res.code)
                setProgressText('Authorization code generated')
                setStatus('success')
                redirectToEditor({ code: res.code })
                return
            }

            const nextError = 'error' in res ? res.error : 'Failed to authorize extension.'
            if (nextError === 'Not authenticated') {
                setNeedsSignIn(true)
                setStatus('idle')
                return
            }
            setStatus('error')
            setErrorMsg(nextError)
            setDebugDetails(JSON.stringify(res, null, 2))
            redirectToEditor({
                error: 'auth_failed',
                message: nextError,
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const stack = err instanceof Error ? err.stack : undefined
            setStatus('error')
            setErrorMsg('An unexpected error occurred during authorization.')
            setDebugDetails(JSON.stringify({ error: message, stack }, null, 2))
            redirectToEditor({
                error: 'server_error',
                message,
            })
        }
    }

    const handleCancel = () => {
        if (callbackUrl && isValid) {
            redirectToEditor({
                error: 'cancelled',
                message: 'User cancelled authorization',
            })
        }

        setTimeout(() => {
            window.location.assign('/hub')
        }, 300)
    }

    const handleManualLaunch = () => {
        if (!authCode) return
        redirectToEditor({ code: authCode })
    }

    const handleSignIn = () => {
        const nextPath = `${window.location.pathname}${window.location.search}`
        window.location.assign(`/login?redirect=${encodeURIComponent(nextPath)}`)
    }

    if (needsSignIn) {
        return (
            <AuthorizationFrame
                accountLabel="Not signed in"
                callbackDestination={callbackDestination}
                editorName={editorName}
                flowStatus="idle"
                isValid={isValid}
                primaryAction={{
                    icon: ShieldCheck,
                    label: 'Sign in',
                    onClick: handleSignIn,
                }}
                secondaryAction={{
                    label: 'Cancel',
                    onClick: handleCancel,
                }}
                statusCopy={{
                    title: 'Sign in required',
                    description: 'Sign in before authorizing this editor connection.',
                }}
            >
                <AuthRequiredPanel editorName={editorName} />
            </AuthorizationFrame>
        )
    }

    return (
        <AuthorizationFrame
            accountLabel={accountLabel}
            callbackDestination={callbackDestination}
            editorName={editorName}
            flowStatus={status}
            isValid={isValid}
            primaryAction={
                status === 'success'
                    ? {
                        icon: ExternalLink,
                        label: `Open ${editorName}`,
                        onClick: handleManualLaunch,
                    }
                    : status === 'error'
                        ? {
                            icon: RefreshCw,
                            label: 'Authorize',
                            onClick: handleAuthorize,
                        }
                        : {
                            disabled: status === 'authorizing' || !isValid,
                            icon: status === 'authorizing' ? Loader2 : ShieldCheck,
                            label: 'Authorize',
                            loading: status === 'authorizing',
                            onClick: handleAuthorize,
                        }
            }
            secondaryAction={
                status === 'success'
                    ? {
                        label: 'Dashboard',
                        onClick: () => router.push('/hub'),
                    }
                    : {
                        label: 'Cancel',
                        onClick: handleCancel,
                    }
            }
            statusCopy={statusCopy}
        >
            <RightPanel
                debugDetails={debugDetails}
                editorName={editorName}
                errorMsg={errorMsg}
                isDev={isDev}
                isValid={isValid}
                progressText={progressText}
                status={status}
            />
        </AuthorizationFrame>
    )
}

function AuthorizationFrame({
    accountLabel,
    callbackDestination,
    children,
    editorName,
    flowStatus,
    isValid,
    primaryAction,
    secondaryAction,
    statusCopy,
}: {
    accountLabel: string
    callbackDestination: string
    children: React.ReactNode
    editorName: string
    flowStatus: ConnectionStatus
    isValid: boolean
    primaryAction: {
        disabled?: boolean
        icon: LucideIcon
        label: string
        loading?: boolean
        onClick: () => void
    }
    secondaryAction: {
        label: string
        onClick: () => void
    }
    statusCopy: {
        title: string
        description: string
    }
}) {
    const PrimaryIcon = primaryAction.icon

    return (
        <main
            aria-busy={flowStatus === 'authorizing'}
            className="h-screen max-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-zinc-950 dark:bg-[linear-gradient(180deg,#09090b_0%,#111827_100%)] dark:text-zinc-50"
        >
            <div className="flex h-full flex-col lg:flex-row">
                {/* LEFT PANE: Authentication Details & Controls */}
                <aside className="w-full lg:w-[380px] xl:w-[420px] flex flex-col justify-between p-6 border-b lg:border-b-0 lg:border-r border-zinc-200/80 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/90 h-full shrink-0 overflow-hidden">
                    {/* Header */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-blue-600 text-lg font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.25)]">
                                    N
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                        Extension Connection
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Connect {editorName} to NetworkBase
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div
                            className={cn(
                                'inline-block rounded-md border px-2.5 py-1 text-xs font-medium',
                                isValid
                                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200'
                                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
                            )}
                        >
                            {isValid ? '✓ Verified callback' : '✗ Callback blocked'}
                        </div>
                    </div>

                    {/* Authentication details card */}
                    <div className="my-auto py-6 space-y-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            Authentication Details
                        </p>
                        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 space-y-3 shadow-sm dark:border-white/5 dark:bg-white/[0.02]">
                            <InfoRow icon={Fingerprint} label="Account" value={accountLabel} />
                            <InfoRow icon={Terminal} label="Editor" value={editorName} />
                            <InfoRow icon={Lock} label="Callback" value={callbackDestination} />
                        </div>
                    </div>

                    {/* Actions Area */}
                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-zinc-200/60 dark:border-white/5">
                        <Button
                            className="h-12 min-w-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(37,99,235,0.2)] hover:bg-blue-700 active:translate-y-px dark:bg-blue-500 dark:hover:bg-blue-400"
                            disabled={primaryAction.disabled}
                            onClick={primaryAction.onClick}
                            type="button"
                        >
                            <PrimaryIcon className={cn('size-4 mr-2', primaryAction.loading ? 'motion-safe:animate-spin' : '')} />
                            <span className="truncate whitespace-nowrap">{primaryAction.label}</span>
                        </Button>
                        <Button
                            className="h-12 rounded-lg border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 active:translate-y-px dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-50 dark:hover:bg-white/[0.08]"
                            onClick={secondaryAction.onClick}
                            type="button"
                            variant="outline"
                        >
                            <X className="size-4 mr-2" />
                            <span className="whitespace-nowrap">{secondaryAction.label}</span>
                        </Button>
                    </div>
                </aside>

                {/* RIGHT PANE: Information & Flow Timeline */}
                <section className="flex-1 flex flex-col justify-between p-6 lg:p-8 xl:p-10 h-full overflow-hidden bg-zinc-50/30 dark:bg-zinc-950/10">
                    {/* Welcome Header */}
                    <div className="grid gap-4 md:grid-cols-[1fr_240px] xl:grid-cols-[1fr_280px] items-start">
                        <div>
                            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-950 dark:text-white xl:text-4xl">
                                Authorize editor session
                            </h1>
                            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                Review the connection details and flow stages before generating your secure editor credentials.
                            </p>
                        </div>
                        <div className="rounded-lg border border-zinc-200/80 bg-white/70 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                Status: {statusCopy.title}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                                {statusCopy.description}
                            </p>
                        </div>
                    </div>

                    {/* Flow Steps / Children */}
                    <div className="my-auto flex items-center justify-center py-4 w-full">
                        {children}
                    </div>

                    {/* Permissions Checklist */}
                    <div className="space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            Security & Permissions Scope
                        </p>
                        <div className="grid gap-3 md:grid-cols-3">
                            <PermissionItem title="One editor session" text="The token belongs to this browser-approved request." />
                            <PermissionItem title="Revocable access" text="Remove this session later in your settings." />
                            <PermissionItem title="No password sharing" text="Your password is never sent to the editor." />
                        </div>
                    </div>
                </section>
            </div>
        </main>
    )
}

function RightPanel({
    debugDetails,
    editorName,
    errorMsg,
    isDev,
    isValid,
    progressText,
    status,
}: {
    debugDetails: string | null
    editorName: string
    errorMsg: string | null
    isDev: boolean
    isValid: boolean
    progressText: string
    status: ConnectionStatus
}) {
    return (
        <div className="grid w-full gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-lg border border-zinc-200 bg-white/82 p-4 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                            Connection flow
                        </p>
                        <p className="mt-1 max-w-[58ch] text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                            The browser approves the request, the server creates the token, and the editor receives it through the callback.
                        </p>
                    </div>
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300">
                        {status === 'success' ? 'Complete' : status === 'authorizing' ? 'In progress' : status === 'error' ? 'Retry available' : 'Awaiting action'}
                    </div>
                </div>

                <ol className="mt-4 grid gap-3 md:grid-cols-3">
                    {FLOW_STEPS.map((step) => (
                        <FlowStepCard
                            key={step.key}
                            state={getStepState(step.key, status, isValid)}
                            step={step}
                        />
                    ))}
                </ol>
            </section>

            <StateDetail
                debugDetails={debugDetails}
                editorName={editorName}
                errorMsg={errorMsg}
                isDev={isDev}
                isValid={isValid}
                progressText={progressText}
                status={status}
            />
        </div>
    )
}

function AuthRequiredPanel({ editorName }: { editorName: string }) {
    return (
        <section className="rounded-lg border border-zinc-200 bg-white/82 p-4 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                        Connection flow
                    </p>
                    <p className="mt-1 max-w-[58ch] text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        Sign in before {editorName} can receive a revocable editor token.
                    </p>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                    Sign in required
                </div>
            </div>

            <ol className="mt-4 grid gap-3 md:grid-cols-3">
                {FLOW_STEPS.map((step) => (
                    <FlowStepCard
                        key={step.key}
                        state={step.key === 'authorize' ? 'blocked' : 'pending'}
                        step={step}
                    />
                ))}
            </ol>
        </section>
    )
}

function FlowStepCard({ state, step }: { state: StepState; step: FlowStep }) {
    const Icon = step.icon

    return (
        <li
            className={cn(
                'rounded-lg border p-4 transition duration-200',
                state === 'complete' && 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-400/10',
                state === 'active' && 'border-blue-300 bg-blue-50/80 shadow-[0_18px_46px_rgba(37,99,235,0.12)] dark:border-blue-400/30 dark:bg-blue-400/10',
                state === 'pending' && 'border-zinc-200 bg-zinc-50/70 dark:border-white/10 dark:bg-white/[0.035]',
                state === 'error' && 'border-rose-200 bg-rose-50/80 dark:border-rose-400/25 dark:bg-rose-400/10',
                state === 'blocked' && 'border-amber-200 bg-amber-50/80 dark:border-amber-400/25 dark:bg-amber-400/10',
            )}
        >
            <div className="flex items-center justify-between gap-3">
                <div
                    className={cn(
                        'flex size-9 items-center justify-center rounded-md border',
                        state === 'complete' && 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
                        state === 'active' && 'border-blue-200 bg-white text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200',
                        state === 'pending' && 'border-zinc-200 bg-white text-zinc-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-400',
                        state === 'error' && 'border-rose-200 bg-white text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
                        state === 'blocked' && 'border-amber-200 bg-white text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
                    )}
                >
                    {state === 'complete' ? <CheckCircle2 className="size-4" /> : state === 'error' ? <XCircle className="size-4" /> : <Icon className="size-4" />}
                </div>
                <span className="rounded-md border border-black/5 bg-white/70 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300">
                    {STEP_STATE_LABEL[state]}
                </span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {step.title}
            </h3>
            <p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
                {step.description}
            </p>
        </li>
    )
}

function StateDetail({
    debugDetails,
    editorName,
    errorMsg,
    isDev,
    isValid,
    progressText,
    status,
}: {
    debugDetails: string | null
    editorName: string
    errorMsg: string | null
    isDev: boolean
    isValid: boolean
    progressText: string
    status: ConnectionStatus
}) {
    if (!isValid) {
        return (
            <DetailShell icon={AlertCircle} tone="warning" title="Request cannot continue">
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    This page only accepts callbacks from supported editors, localhost editor bridges, or custom IDE schemes.
                </p>
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
                    Cancel this request and start the connection again from the editor.
                </div>
            </DetailShell>
        )
    }

    if (status === 'authorizing') {
        return (
            <DetailShell icon={KeyRound} tone="info" title="Generating device token">
                <div aria-live="polite" className="text-sm font-medium text-blue-700 dark:text-blue-200">
                    {progressText}
                </div>
                <div className="mt-5 space-y-3">
                    <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/10">
                        <div className="h-full w-2/3 rounded-full bg-blue-600 motion-safe:animate-pulse dark:bg-blue-400" />
                    </div>
                    <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        The token is generated on the server and linked to this browser-approved editor session.
                    </p>
                </div>
            </DetailShell>
        )
    }

    if (status === 'success') {
        return (
            <DetailShell icon={CheckCircle2} tone="success" title="Editor connected">
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    The secure token was generated and sent back to {editorName}.
                </p>
                <div className="mt-5 grid gap-3">
                    <NextItem text={`Check your ${editorName} window to confirm you are signed in.`} />
                    <NextItem text="You can close this browser tab after the editor finishes opening." />
                </div>
            </DetailShell>
        )
    }

    if (status === 'error') {
        return (
            <DetailShell icon={XCircle} tone="error" title="Connection failed">
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    {errorMsg || 'We could not complete the authorization request.'}
                </p>
                {isDev && debugDetails ? (
                    <pre className="mt-5 max-h-44 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-300">
                        {debugDetails}
                    </pre>
                ) : null}
            </DetailShell>
        )
    }

    return (
        <DetailShell icon={ShieldCheck} tone="info" title="Awaiting authorization">
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Authorizing creates a revocable token for {editorName}. Cancel returns to the editor without granting access.
            </p>
            <div className="mt-5 grid gap-3">
                <NextItem text="The editor receives a token only after you approve this request." />
                <NextItem text="The token can be revoked from integrations settings." />
            </div>
        </DetailShell>
    )
}

function DetailShell({
    children,
    icon,
    title,
    tone,
}: {
    children: React.ReactNode
    icon: LucideIcon
    title: string
    tone: 'info' | 'success' | 'error' | 'warning'
}) {
    const Icon = icon

    return (
        <section className="rounded-lg border border-zinc-200 bg-white/82 p-5 shadow-[0_30px_90px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex items-center gap-3">
                <div
                    className={cn(
                        'flex size-10 items-center justify-center rounded-lg border',
                        tone === 'info' && 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200',
                        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
                        tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
                        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
                    )}
                >
                    <Icon className="size-5" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
                    {title}
                </h2>
            </div>
            <div className="mt-5">
                {children}
            </div>
        </section>
    )
}

function InfoRow({
    icon,
    label,
    value,
}: {
    icon: LucideIcon
    label: string
    value: string
}) {
    const Icon = icon

    return (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md bg-white px-3 py-2 dark:bg-white/[0.04]">
            <Icon className="row-span-2 size-4 text-zinc-500 dark:text-zinc-400" />
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {label}
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {value}
            </span>
        </div>
    )
}

function PermissionItem({ title, text }: { title: string; text: string }) {
    return (
        <div className="flex gap-3 rounded-lg border border-zinc-200 bg-white/70 p-2.5 dark:border-white/10 dark:bg-white/[0.035]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-300" />
            <div>
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    {title}
                </p>
                <p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
                    {text}
                </p>
            </div>
        </div>
    )
}

function NextItem({ text }: { text: string }) {
    return (
        <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            <span className="text-sm leading-5 text-zinc-700 dark:text-zinc-200">
                {text}
            </span>
        </div>
    )
}

function AuthorizeFallback() {
    return (
        <main className="grid min-h-[100dvh] place-items-center bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.05]">
                <div className="flex items-center gap-3 text-sm font-medium">
                    <Loader2 className="size-4 motion-safe:animate-spin text-blue-600 dark:text-blue-300" />
                    Loading authorization workspace
                </div>
            </div>
        </main>
    )
}

export default function AuthorizePage() {
    return (
        <Suspense fallback={<AuthorizeFallback />}>
            <AuthorizePageInner />
        </Suspense>
    )
}
