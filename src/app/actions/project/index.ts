// Module barrel — re-exports from split modules
// crud: create, update, delete projects
// members: follow, bookmark, members, project groups
// queries: tasks, sprints, analytics

export {
    // CRUD
    createProjectAction,
    updateProject,
    deleteProject,
    deleteProjectDraftAction,
    updateProjectStageAction,
    updateProjectLifecycleAction,
    finalizeProjectAction,
    retryGithubImportAction,

    // Members & Social
    ensureProjectGroupExists,
    toggleProjectBookmarkAction,
    toggleProjectFollowAction,
    getProjectMembersAction,

    // Queries
    incrementProjectViewAction,
    getProjectUserStateAction,
    fetchProjectTasksAction,
    fetchProjectSprintsAction,
    fetchSprintTasksAction,
    getProjectAnalyticsAction,
    getProjectSyncStatus,

    // Task & Sprint CRUD
    createTaskAction,
    createSprintAction,
    startSprintAction,
    completeSprintAction,
    moveTaskToSprintAction,
    deleteTaskAction,
} from './_all'
