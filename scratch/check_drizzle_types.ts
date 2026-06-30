import { db } from '../src/lib/db';

async function test() {
    const data = await db.query.profiles.findFirst({
        columns: {
            id: true,
            // @ts-expect-error
            onboardingStatus: true,
        }
    });
}
