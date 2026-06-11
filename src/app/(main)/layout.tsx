import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

async function ResolvedProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getViewerAuthContext();

  return (
    <MainRuntimeProviders initialUser={user} initialProfile={null}>
      <MainLayout>{children}</MainLayout>
    </MainRuntimeProviders>
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
