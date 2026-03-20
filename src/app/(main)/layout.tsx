import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

export default async function MainRouteLayout({
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
