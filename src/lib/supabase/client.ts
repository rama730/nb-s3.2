import { createBrowserClient } from '@supabase/ssr'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'
import { browserSessionCookieStore, clearLegacySupabaseBrowserCookies } from '@/lib/supabase/browser-cookie-store'

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (client) return client;
  const env = resolveSupabasePublicEnv('supabase.browser')
  clearLegacySupabaseBrowserCookies()

  client = createBrowserClient(
    env.url,
    env.anonKey,
    {
      cookies: browserSessionCookieStore,
      auth: {
        persistSession: typeof window !== 'undefined' && window.self === window.top,
        lock: async (name: string, acquireTimeout: number, acquire: () => Promise<any>) => {
          return await acquire()
        },
      },
    }
  )
  return client;
}

export const createSupabaseBrowserClient = createClient
