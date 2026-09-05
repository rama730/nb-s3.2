import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthRouteProviders initialUser={null} initialProfile={null}>
      <div className="auth-root w-full">
        {children}
      </div>
    </AuthRouteProviders>
  );
}
