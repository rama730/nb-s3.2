'use client';

import { AuthProvider } from '@/components/providers/AuthProvider';

interface AuthRouteProvidersProps {
  children: React.ReactNode;
}

export function AuthRouteProviders({ children }: AuthRouteProvidersProps) {
  return (
    <AuthProvider initialUser={null} initialProfile={null}>
      {children}
    </AuthProvider>
  );
}

