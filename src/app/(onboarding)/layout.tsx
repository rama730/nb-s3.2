import '@/styles/onboarding-tokens.css';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { getViewerProfileContext } from '@/lib/server/viewer-context';
import { OnboardingBootstrapProvider } from '@/components/onboarding/OnboardingBootstrapProvider';
import { db } from '@/lib/db';
import { onboardingDrafts } from '@/lib/db/schema';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  ONBOARDING_SCHEMA_VERSION,
  clampCompletedThrough,
  clampOnboardingStep,
  isCompletedOnboardingStatus,
  normalizeOnboardingSection,
} from '@/lib/onboarding/state';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
  }) {
  const { user, profile } = await getViewerProfileContext();
  if (!user) redirect('/login');

  const draft = await db.query.onboardingDrafts.findFirst({
    where: and(
      eq(onboardingDrafts.userId, user.id),
      or(
        isNull(onboardingDrafts.expiresAt),
        gt(onboardingDrafts.expiresAt, sql`CURRENT_TIMESTAMP`),
      ),
    ),
    columns: {
      step: true,
      completedThrough: true,
      activeSection: true,
      version: true,
      schemaVersion: true,
      draft: true,
      expiresAt: true,
      updatedAt: true,
    },
  });

  if (isCompletedOnboardingStatus(profile?.onboardingStatus, profile?.username)) {
    redirect('/hub');
  }

  const bootstrap = {
    userId: user.id,
    status: profile?.onboardingStatus ?? 'not_started',
    draft: {
      step: clampOnboardingStep(draft?.step),
      completedThrough: clampCompletedThrough(draft?.completedThrough),
      activeSection: normalizeOnboardingSection(draft?.activeSection),
      version: draft?.version ?? 0,
      schemaVersion: draft?.schemaVersion ?? ONBOARDING_SCHEMA_VERSION,
      data: draft?.draft ?? {},
      updatedAt: draft?.updatedAt?.toISOString() ?? null,
    },
  } as const;

  return (
    <AuthRouteProviders initialUser={user} initialProfile={profile}>
      <OnboardingBootstrapProvider value={bootstrap}>
        {children}
      </OnboardingBootstrapProvider>
    </AuthRouteProviders>
  );
}
