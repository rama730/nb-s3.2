import { profiles } from '../src/lib/db/schema';

type ProfileSelect = typeof profiles.$inferSelect;
type ProfileKeys = keyof ProfileSelect;

const checkKeys: ProfileKeys[] = [
    'id',
    'lastActiveAt',
    // Let's see if onboardingStatus exists
    // @ts-expect-error - if it's missing, let the compiler tell us
    'onboardingStatus',
];
