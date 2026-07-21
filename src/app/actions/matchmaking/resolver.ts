'use server'

import { db } from '@/lib/db';
import { profiles, projectOpenRoles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rolePreferenceLabel, weeklyCapacityLabel, experienceLevelLabel } from '@/lib/profile/role-preferences';

export interface AttributeAlignment {
  skillsMatch: { matched: string[]; missing: string[] };
  experienceMatch: { required: string | null; actual: string | null; aligns: boolean };
  capacityMatch: { required: string | null; actual: string | null; aligns: boolean };
  commitmentMatch: { required: string | null; actual: string | null; aligns: boolean };
}

export async function getProfileToRoleAlignmentAction(
  profileId: string,
  roleId: string
): Promise<AttributeAlignment> {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  const role = await db.query.projectOpenRoles.findFirst({
    where: eq(projectOpenRoles.id, roleId),
  });

  if (!profile || !role) {
    return {
      skillsMatch: { matched: [], missing: [] },
      experienceMatch: { required: null, actual: null, aligns: false },
      capacityMatch: { required: null, actual: null, aligns: false },
      commitmentMatch: { required: null, actual: null, aligns: false },
    };
  }

  // 1. Skills Matching
  const profileSkills = new Set((profile.skills || []).map(s => s.toLowerCase()));
  const requiredSkills = role.skills || [];
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of requiredSkills) {
    if (profileSkills.has(skill.toLowerCase())) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  // 2. Experience Level Check
  // Map experience hierarchy: junior=1, mid=2, senior=3, lead=4, founder=5, student=0
  const hierarchy: Record<string, number> = {
    student: 0,
    junior: 1,
    mid: 2,
    senior: 3,
    lead: 4,
    founder: 5,
  };
  const requiredExp = role.experienceRequired || null;
  const actualExp = profile.experienceLevel || null;
  const expAligns =
    !requiredExp ||
    !actualExp ||
    (hierarchy[actualExp] ?? 0) >= (hierarchy[requiredExp] ?? 0);

  // 3. Capacity (weekly hours) Check
  // Capacity hierarchy: lt_5=0, h_5_10=1, h_10_20=2, h_20_40=3, h_40_plus=4
  const capacityHierarchy: Record<string, number> = {
    lt_5: 0,
    h_5_10: 1,
    h_10_20: 2,
    h_20_40: 3,
    h_40_plus: 4,
  };
  const requiredCap = role.hoursPerWeek || null;
  const actualCap = profile.hoursPerWeek || null;
  const capAligns =
    !requiredCap ||
    !actualCap ||
    (capacityHierarchy[actualCap] ?? 0) >= (capacityHierarchy[requiredCap] ?? 0);

  // 4. Commitment Check
  // commitmentType aligns with standard openTo preferences
  const requiredCommitment = role.commitmentType || null; // e.g. "Freelance projects" or "Contract roles"
  const actualOpenTo = profile.openTo || [];
  const commitAligns =
    !requiredCommitment ||
    actualOpenTo.some(opt => opt.toLowerCase() === requiredCommitment.toLowerCase());

  return {
    skillsMatch: { matched, missing },
    experienceMatch: {
      required: requiredExp ? experienceLevelLabel(requiredExp) : null,
      actual: actualExp ? experienceLevelLabel(actualExp) : null,
      aligns: expAligns,
    },
    capacityMatch: {
      required: requiredCap ? weeklyCapacityLabel(requiredCap) : null,
      actual: actualCap ? weeklyCapacityLabel(actualCap) : null,
      aligns: capAligns,
    },
    commitmentMatch: {
      required: requiredCommitment ? rolePreferenceLabel(requiredCommitment) || requiredCommitment : null,
      actual: actualOpenTo.length > 0 ? actualOpenTo.map(opt => rolePreferenceLabel(opt) || opt).join(', ') : null,
      aligns: commitAligns,
    },
  };
}
