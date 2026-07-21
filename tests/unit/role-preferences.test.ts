import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRolePreferences,
  replaceRolePreferences,
  rolePreferenceLabel,
  weeklyCapacityLabel,
} from '@/lib/profile/role-preferences'

test('role preferences normalize legacy aliases into stable display order', () => {
  assert.deepEqual(
    getRolePreferences(['freelance', 'Full-time roles', 'cofounder', 'freelance']),
    ['Full-time roles', 'Freelance projects', 'Co-founder opportunities'],
  )
  assert.equal(rolePreferenceLabel('contract'), 'Contract')
  assert.equal(weeklyCapacityLabel('h_10_20'), '10–20 hours per week')
})

test('updating roles retains unrelated legacy collaboration interests', () => {
  assert.deepEqual(
    replaceRolePreferences(
      ['Mentorship', 'Open source collaboration', 'Full-time roles'],
      ['Part-time roles'],
    ),
    ['Mentorship', 'Open source collaboration', 'Part-time roles'],
  )
})
