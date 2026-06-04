export type ProjectRoleFormValue = {
    id?: string;
    role: string;
    count: number;
    description?: string;
    skills?: string[];
};

export type ProjectRolesFormValues = {
    roles: ProjectRoleFormValue[];
};

export function normalizeProjectRoleFormValues(openRoles: unknown): ProjectRoleFormValue[] {
    if (!Array.isArray(openRoles)) return [];

    return openRoles
        .map((role) => {
            const item = role as Record<string, unknown>;
            const rawCount = typeof item.count === "number"
                ? item.count
                : typeof item.count === "string"
                    ? Number.parseInt(item.count, 10)
                    : 1;
            const skills = Array.isArray(item.skills)
                ? item.skills.filter((skill): skill is string => typeof skill === "string")
                : [];

            return {
                id: typeof item.id === "string" ? item.id : undefined,
                role: typeof item.role === "string"
                    ? item.role
                    : typeof item.title === "string"
                        ? item.title
                        : "",
                count: Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1,
                description: typeof item.description === "string" ? item.description : "",
                skills,
            };
        })
        .filter((role) => role.role.trim().length > 0 || role.id);
}
