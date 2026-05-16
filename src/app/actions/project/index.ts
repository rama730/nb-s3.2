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
    updateProjectSettingsAction,
    clearProjectCoverImageAction,
    createProjectCoverImageUploadUrlAction,
    finalizeProjectCoverImageUploadAction,
    getProjectAccessImpactAction,
    getProjectAccessTransitionPreflightAction,
    getProjectCollaboratorSettingsAction,
    getProjectDangerZonePreflightAction,
    getProjectFileWorkspaceSettingsAction,
    readProjectNotificationSettingsAction,
    readProjectMemberNotificationSettingsAction,
    getProjectMemberRemovalPreflightAction,
    getProjectSettingsAuditAction,
    archiveProjectAction,
    finalizeProjectAction,
    removeProjectMemberAction,
    retryGithubImportAction,
    updateProjectFileUploadDefaultsAction,
    updateProjectMemberFileUploadAction,
    updateProjectNotificationSettingsAction,
    updateProjectMemberNotificationSettingsAction,
    updateProjectMemberRoleAction,
    updateProjectPublicTabVisibilityAction,
    updateProjectVisibilityAction,
    resetProjectNotificationSettingsAction,
    resetProjectMemberNotificationSettingsAction,

    // Members & Social
    ensureProjectGroupExists,

    toggleProjectFollowAction,
    getProjectMembersAction,

    // Queries
    incrementProjectViewAction,
    readProjectDetailMetadata,
    readProjectDetailShell,
    readProjectSprintDetail,
    getProjectDetailShellAction,
    getProjectUserStateAction,
    fetchProjectTasksAction,
    fetchProjectSprintsAction,
    fetchProjectSprintDetailAction,
    fetchSprintTasksAction,
    getProjectTaskDetailAction,
    getProjectTaskActivityAction,
    getProjectAnalyticsAction,
    getProjectSyncStatus,

    // Task & Sprint CRUD
    createTaskAction,
    createSprintAction,
    updateSprintAction,
    deleteSprintAction,
    startSprintAction,
    completeSprintAction,
    moveTaskToSprintAction,
    deleteTaskAction,
} from './_all'
