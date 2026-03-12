// Hub Constants

export const FILTER_VIEWS = {
    ALL: 'all',
    TRENDING: 'trending',
    RECOMMENDATIONS: 'recommendations',
    MY_PROJECTS: 'my_projects',
    FOLLOWING: 'following',
} as const;

export const PROJECT_STATUS = {
    ALL: 'all',
    IDEA: 'draft',       // Maps to schema 'draft'
    IN_PROGRESS: 'active', // Maps to schema 'active'
    LAUNCHED: 'completed', // Maps to schema 'completed'
} as const;

export const PROJECT_TYPE = {
    ALL: 'all',
    SIDE_PROJECT: 'side_project',
    STARTUP: 'startup',
    OPEN_SOURCE: 'open_source',
    LEARNING: 'learning',
} as const;

export const SORT_OPTIONS = {
    NEWEST: 'newest',
    OLDEST: 'oldest',
    MOST_VIEWED: 'most_viewed',
    MOST_FOLLOWED: 'most_followed',
    TRENDING: 'trending',
} as const;

export const VIEW_MODES = {
    GRID: 'grid',
    LIST: 'list',
} as const;

// Type exports
export type FilterView = 'all' | 'trending' | 'recommendations' | 'my_projects' | 'following';
export type ProjectStatus = typeof PROJECT_STATUS[keyof typeof PROJECT_STATUS];
export type ProjectType = typeof PROJECT_TYPE[keyof typeof PROJECT_TYPE];
export type SortOption = typeof SORT_OPTIONS[keyof typeof SORT_OPTIONS];
export type ViewMode = typeof VIEW_MODES[keyof typeof VIEW_MODES];
