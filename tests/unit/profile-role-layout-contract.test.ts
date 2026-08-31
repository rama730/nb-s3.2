import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('profile layout keeps skills and roles in one responsive composition', () => {
  const client = read('src/components/profile/v2/ProfileV2Client.tsx')
  const shell = read('src/components/profile/v2/ProfileShell.tsx')
  const rail = read('src/components/profile/v2/ProfileRightRail.tsx')
  const tabs = read('src/components/profile/v2/ProfileTabs.tsx')

  const skillsPosition = client.indexOf('<SkillsCard')
  const rolesPosition = client.indexOf('<OpenToRolesCard')
  assert.ok(skillsPosition >= 0)
  assert.ok(rolesPosition > skillsPosition)
  assert.match(shell, /className="order-3 space-y-6"/)
  assert.match(shell, /className="order-4"/)
  assert.match(shell, /className="order-5 space-y-6"/)
  assert.match(shell, /data-testid="profile-tabs-shell"/)
  assert.match(shell, /style=\{\{ top: "12px" \}\}/)
  assert.doesNotMatch(tabs, /sticky z-/)
  assert.doesNotMatch(shell, /hidden lg:block/)
  assert.doesNotMatch(rail, /title="Collaboration"/)
})

test('current availability is absent from live product contracts and schema', () => {
  const schema = read('src/lib/db/schema/index.ts')
  const onboarding = read('src/components/onboarding/steps/Step2Details.tsx')
  const migration = read('drizzle/0118_remove_profile_availability_status.sql')

  assert.doesNotMatch(schema, /availabilityStatus/)
  assert.doesNotMatch(onboarding, /Current availability|Availability Status/)
  assert.match(onboarding, /Weekly capacity/)
  assert.match(onboarding, /Open to Roles/)
  assert.match(migration, /DROP COLUMN IF EXISTS "availability_status"/)
})
