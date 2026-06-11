import '@/styles/onboarding-tokens.css';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';

import { getViewerProfileContext } from '@/lib/server/viewer-context';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getViewerProfileContext();
  return <AuthRouteProviders initialUser={user} initialProfile={profile}>{children}</AuthRouteProviders>;
}

