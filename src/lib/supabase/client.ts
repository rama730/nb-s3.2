import { createBrowserClient } from '@supabase/ssr'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (client) return client;
  const env = resolveSupabasePublicEnv('supabase.browser')

  client = createBrowserClient(
    env.url,
    env.anonKey
  )
  return client;
}

export const createSupabaseBrowserClient = createClient
