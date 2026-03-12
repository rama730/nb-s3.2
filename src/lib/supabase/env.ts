type SupabasePublicEnv = {
    url: string
    anonKey: string
}

type SupabaseServiceEnv = {
    url: string
    serviceRoleKey: string
}

let cachedPublicEnv: SupabasePublicEnv | null = null
let cachedServiceEnv: SupabaseServiceEnv | null = null

const STATIC_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const STATIC_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const STATIC_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

function readRequiredPublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY', context: string): string {
    const value =
        name === 'NEXT_PUBLIC_SUPABASE_URL'
            ? STATIC_PUBLIC_SUPABASE_URL
            : STATIC_PUBLIC_SUPABASE_ANON_KEY
    if (value) return value
    throw new Error(`[${context}] missing required env var: ${name}`)
}

function readRequiredServiceEnv(context: string): string {
    if (STATIC_SUPABASE_SERVICE_ROLE_KEY) return STATIC_SUPABASE_SERVICE_ROLE_KEY
    throw new Error(`[${context}] missing required env var: SUPABASE_SERVICE_ROLE_KEY`)
}

export function resolveSupabasePublicEnv(context: string): SupabasePublicEnv {
    if (cachedPublicEnv) return cachedPublicEnv
    cachedPublicEnv = {
        url: readRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL', context),
        anonKey: readRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', context),
    }
    return cachedPublicEnv
}

export function resolveSupabaseServiceEnv(context: string): SupabaseServiceEnv {
    if (cachedServiceEnv) return cachedServiceEnv
    const { url } = resolveSupabasePublicEnv(context)
    cachedServiceEnv = {
        url,
        serviceRoleKey: readRequiredServiceEnv(context),
    }
    return cachedServiceEnv
}
