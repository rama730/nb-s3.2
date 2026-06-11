'use client';

import { AuthProvider } from '@/components/providers/AuthProvider';
import type { User } from '@supabase/supabase-js';

interface AuthRouteProvidersProps {
  children: React.ReactNode;
  initialUser: User | null;
  initialProfile?: any | null;
}

export function AuthRouteProviders({ children, initialUser, initialProfile = null }: AuthRouteProvidersProps) {
  return (
    <AuthProvider initialUser={initialUser} initialProfile={initialProfile}>
      {children}
    </AuthProvider>
  );
}

