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
    updateProjectExternalLinksAction,
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
    getProjectLiveStatsAction,

    // Queries
    incrementProjectViewAction,
    readProjectDetailShell,
    readProjectDetailMetadata,
    fetchProjectTasksAction,
    fetchProjectTaskPreviewsAction,
    fetchProjectLinkPreviewsAction,
    fetchProjectSprintsAction,
    readProjectSprintDetail,
    fetchProjectSprintDetailAction,
    fetchProjectSprintTimelinePageAction,
    getProjectTaskDetailAction,
    markTaskAsReadAction,
    readProjectAnalyticsOverviewAction,
    readProjectAnalyticsMembersAction,
    readProjectMemberAnalyticsAction,
    readProjectAnalyticsTimelineAction,
    getProjectSyncStatus,

    // Task & Sprint CRUD
    createTaskAction,
    createSprintAction,
    updateSprintAction,
    deleteSprintAction,
    startSprintAction,
    completeSprintAction,
    reopenSprintAction,
    archiveSprintAction,
    cancelSprintAction,
    deleteTaskAction,
    getProfileProjectsWithOpenRolesAction,
} from './_all';

export { readProjectDocAction, validateProjectDocAction, readProjectDocReferenceOptionsAction, readProjectDocSmartBlockPreviewsAction, readProjectDocSettingsAction, updateProjectDocSettingsAction, createProjectMarkdownAction, listProjectMarkdownsAction, readProjectMarkdownSearchAction, unlinkProjectDocAction } from './doc';

export { createProjectUpdateAction, createProjectUpdateCommentAction, deleteProjectUpdateAction, deleteProjectUpdateCommentAction, editProjectUpdateAction, readProjectUpdateAction, readProjectUpdateCommentsAction, readProjectUpdateContextOptionsAction, readProjectUpdatesAction, resolveProjectUpdateMentionTargetAction, toggleProjectUpdateLikeAction, toggleProjectUpdatePinAction, readProjectUpdateDraftAction, saveProjectUpdateDraftAction, createProjectUpdateMediaUploadUrlAction, finalizeProjectUpdateMediaUploadAction, type ProjectUpdateCommentView, type ProjectUpdateMovementSummary, type ProjectUpdateView } from './updates';

export { getSyncPreviewAction } from './sync-preview';
export * from "./workflow";
