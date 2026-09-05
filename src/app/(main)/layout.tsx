import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeAuthNextPath } from '@/lib/auth/redirects';
import { hasCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { getViewerProfileContext } from '@/lib/server/viewer-context';

async function ResolvedProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getViewerProfileContext();

  if (user && !(await hasCurrentLegalAcceptance(user.id))) {
    const headerStore = await headers();
    const nextPath = normalizeAuthNextPath(
      headerStore.get('x-networkbase-request-target'),
    );
    redirect(`/legal/accept?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <AuthRouteProviders initialUser={user} initialProfile={profile}>
      <MainRuntimeProviders>
        <MainLayout>{children}</MainLayout>
      </MainRuntimeProviders>
    </AuthRouteProviders>
  );
}

import { Suspense } from 'react';

export default function MainRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950" />}>
      <ResolvedProviders>{children}</ResolvedProviders>
    </Suspense>
  );
}
