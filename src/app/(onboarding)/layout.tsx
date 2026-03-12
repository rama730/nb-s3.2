import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthRouteProviders>{children}</AuthRouteProviders>;
}

