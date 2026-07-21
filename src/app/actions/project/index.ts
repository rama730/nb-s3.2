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
    getProjectLiveStatsAction,
    getAdminProjectsAction,

    // Queries
    incrementProjectViewAction,
    readProjectDetailShell,
    readProjectDetailMetadata,
    fetchProjectTasksAction,
    fetchProjectTaskPreviewsAction,
    fetchProjectSprintsAction,
    readProjectSprintDetail,
    fetchProjectSprintDetailAction,
    fetchProjectSprintTimelinePageAction,
    getProjectTaskDetailAction,
    getProjectTaskActivityAction,
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
    completeSprintAction,
    deleteTaskAction,
    getProfileProjectsWithOpenRolesAction,
} from './_all';

export { readProjectDocAction, readProjectDocDraftAction, saveProjectDocDraftAction, publishProjectDocAction, restoreProjectDocVersionAction, setProjectDocPublishedVersionAction, deleteProjectDocVersionAction, discardProjectDocDraftAction, listProjectDocVersionsAction, validateProjectDocAction, readProjectDocReferenceOptionsAction, readProjectDocSmartBlockPreviewsAction, readProjectDocImportCandidatesAction, importProjectDocFromFileAction, applyProjectDocCreationIntentAction, createProjectDocAssetUploadUrlAction, finalizeProjectDocAssetUploadAction, deleteProjectDocAssetAction, readProjectDocSettingsAction, updateProjectDocSettingsAction, createProjectMarkdownAction, listProjectMarkdownsAction, readProjectMarkdownSearchAction, unlinkProjectDocAction } from './doc';

export { createProjectUpdateAction, createProjectUpdateCommentAction, deleteProjectUpdateAction, deleteProjectUpdateCommentAction, editProjectUpdateAction, readProjectUpdateAction, readProjectUpdateCommentsAction, readProjectUpdateContextOptionsAction, readProjectUpdatesAction, resolveProjectUpdateMentionTargetAction, toggleProjectUpdateLikeAction, toggleProjectUpdatePinAction, readProjectUpdateDraftAction, saveProjectUpdateDraftAction, createProjectUpdateMediaUploadUrlAction, finalizeProjectUpdateMediaUploadAction, type ProjectUpdateCommentView, type ProjectUpdateMovementSummary, type ProjectUpdateView } from './updates';

export { getSyncPreviewAction } from './sync-preview';
