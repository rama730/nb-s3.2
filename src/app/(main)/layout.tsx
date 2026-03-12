import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { getViewerProfileContext } from '@/lib/server/viewer-context';

export default async function MainRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getViewerProfileContext();

  return (
    <MainRuntimeProviders initialUser={user} initialProfile={profile}>
      <MainLayout>{children}</MainLayout>
    </MainRuntimeProviders>
  );
}

