import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthRouteProviders initialUser={null} initialProfile={null}>
      {children}
    </AuthRouteProviders>
  );
}
