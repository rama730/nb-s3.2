import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

async function ResolvedProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getViewerAuthContext();

  return (
    <AuthRouteProviders initialUser={user} initialProfile={null}>
      <MainRuntimeProviders initialUser={user}>
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
