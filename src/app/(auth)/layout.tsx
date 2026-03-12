import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthRouteProviders>{children}</AuthRouteProviders>;
}

