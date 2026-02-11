import { pgTable, uuid, text, timestamp, boolean, jsonb, index, uniqueIndex, integer, bigint, foreignKey } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'


// ============================================================================
// PROFILES TABLE
// ============================================================================
export const profiles = pgTable('profiles', {
    id: uuid('id').primaryKey(), // References auth.users.id
    email: text('email').notNull(),
    username: text('username').unique(),
    fullName: text('full_name'),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    bio: text('bio'),
    headline: text('headline'),
    location: text('location'),
    website: text('website'),
    skills: jsonb('skills').$type<string[]>().default([]),
    interests: jsonb('interests').$type<string[]>().default([]),
    experience: jsonb('experience').$type<any[]>().default([]),
    education: jsonb('education').$type<any[]>().default([]),
    openTo: jsonb('open_to').$type<string[]>().default([]),
    availabilityStatus: text('availability_status', { enum: ['available', 'busy', 'offline', 'focusing'] }).default('available'),
    socialLinks: jsonb('social_links').$type<Record<string, string>>().default({}),
    visibility: text('visibility', { enum: ['public', 'connections', 'private'] }).default('public'),
    messagePrivacy: text('message_privacy', { enum: ['everyone', 'connections'] }).default('connections'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Workspace dashboard layout customization (JSONB, NULL = default layout)
    workspaceLayout: jsonb('workspace_layout').$type<{
        version: number;
        widgets: Array<{
            widgetId: string;
            col: number;
            row: number;
            colSpan: number;
            rowSpan: number;
        }>;
    } | null>().default(null),
    // Pure Optimization: Denormalized counts for 1M+ Users Scalability
    connectionsCount: integer('connections_count').default(0).notNull(),
    projectsCount: integer('projects_count').default(0).notNull(),
    followersCount: integer('followers_count').default(0).notNull(),
}, (t) => ({
    // Optimize lookups by username (common in URLs) and email (auth)
    usernameIdx: index('profiles_username_idx').on(t.username),
    emailIdx: index('profiles_email_idx').on(t.email),
    // Optimization: GIN Index for fast skill matching (1M Users Scalability)
    skillsIdx: index('profiles_skills_idx').using('gin', t.skills),
    interestsIdx: index('profiles_interests_idx').using('gin', t.interests),
    // Optimization: Sort Index for ISR (Profile Page Optimization)
    // Optimized for getPopularUsernames which sorts by createdAt DESC
    createdAtIdx: index('profiles_created_at_idx').on(t.createdAt),
    // Optimization: GIN Index for fast user search (Connections Optimization)
    usernameSearchIdx: index('profiles_username_search_idx').using('gin', sql`${t.username} gin_trgm_ops`),
    fullNameSearchIdx: index('profiles_full_name_search_idx').using('gin', sql`${t.fullName} gin_trgm_ops`),
    // Optimization: Performance indices for stats sorting (Leaderboards/Popularity)
    connectionsCountIdx: index('profiles_connections_count_idx').on(t.connectionsCount),
    projectsCountIdx: index('profiles_projects_count_idx').on(t.projectsCount),
}))

// ============================================================================
// CONNECTIONS TABLE
// ============================================================================
export const connections = pgTable('connections', {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'blocked'] }).default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    // Optimize fetching connections for a user
    requesterIdx: index('connections_requester_idx').on(t.requesterId),
    addresseeIdx: index('connections_addressee_idx').on(t.addresseeId),
    // Composite index for common "my accepted connections" query
    statusRequesterIdx: index('connections_status_requester_idx').on(t.status, t.requesterId),
    statusAddresseeIdx: index('connections_status_addressee_idx').on(t.status, t.addresseeId),

    // Pure Optimization: Composite Indices for Stats & Requests (1M+ Users)
    // 1. "Connections This Month" Stats (Fast Aggregation)
    requesterStatsIdx: index('connections_requester_stats_idx').on(t.requesterId, t.status, t.updatedAt),
    addresseeStatsIdx: index('connections_addressee_stats_idx').on(t.addresseeId, t.status, t.updatedAt),

    // 2. "Pending Requests" Sorting (Fast List)
    pendingRequestsIdx: index('connections_pending_idx').on(t.status, t.createdAt),
}))

export const connectionSuggestionDismissals = pgTable('connection_suggestion_dismissals', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    dismissedProfileId: uuid('dismissed_profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    userDismissedUniqueIdx: uniqueIndex('connection_suggestion_dismissals_user_profile_uidx').on(t.userId, t.dismissedProfileId),
    userCreatedIdx: index('connection_suggestion_dismissals_user_created_idx').on(t.userId, t.createdAt),
}))

// ============================================================================
// CONVERSATIONS TABLE (Moved up for Project reference)
// ============================================================================
export const conversations = pgTable('conversations', {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['dm', 'group', 'project_group'] }).default('dm').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================================
// PROJECTS TABLE
// ============================================================================
export const projects = pgTable('projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    // Optimization: O(1) Chat Lookup (1M Users)
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    slug: text('slug').unique(),
    description: text('description'),
    problemStatement: text('problem_statement'),
    solutionStatement: text('solution_statement'),
    shortDescription: text('short_description'),
    coverImage: text('cover_image'),
    category: text('category'),
    viewCount: integer('view_count').default(0),
    followersCount: integer('followers_count').default(0).notNull(),
    savesCount: integer('saves_count').default(0).notNull(),
    tags: jsonb('tags').$type<string[]>().default([]),
    skills: jsonb('skills').$type<string[]>().default([]),
    visibility: text('visibility', { enum: ['public', 'private', 'unlisted'] }).default('public'),
    status: text('status', { enum: ['draft', 'active', 'completed', 'archived'] }).default('draft'),

    // Project Key System
    key: text('key').unique(), // e.g. "NB"
    currentTaskNumber: integer('current_task_number').default(0),

    lookingForCollaborators: boolean('looking_for_collaborators').default(false),
    maxCollaborators: text('max_collaborators'),
    lifecycleStages: jsonb('lifecycle_stages').$type<string[]>().default([]),
    currentStageIndex: integer('current_stage_index').default(0),
    importSource: jsonb('import_source').$type<{
        type: 'github' | 'upload' | 'scratch';
        repoUrl?: string;
        branch?: string;
        s3Key?: string;
        metadata?: Record<string, any>;
    }>(),
    syncStatus: text('sync_status', { enum: ['pending', 'cloning', 'indexing', 'ready', 'failed'] }).default('ready').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    ownerIdx: index('projects_owner_idx').on(t.ownerId),
    conversationIdx: index('projects_conversation_idx').on(t.conversationId),
    createdAtIdx: index('projects_created_at_idx').on(t.createdAt),
    // Multi-column indexes for filtering (critical for 1M users)
    statusVisibilityIdx: index('projects_status_visibility_idx').on(t.status, t.visibility),
    categoryStatusIdx: index('projects_category_status_idx').on(t.category, t.status),
    // Sort index for the main "Newest Projects" feed
    createdAtStatusIdx: index('projects_created_at_status_idx').on(t.createdAt, t.status),
    keyIdx: index('projects_key_idx').on(t.key),
    // Optimization: GIN Index for fast project search (Hub Optimization)
    // Note: Requires pg_trgm extension. If fails, fallback to b-tree on title is suboptimal but works.
    titleSearchIdx: index('projects_title_search_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    descriptionSearchIdx: index('projects_description_search_idx').using('gin', sql`${t.description} gin_trgm_ops`),

    // Pure Optimization: Composite Indices for Sorted Feeds (Avoids Sorting after Filtering)
    // 1. "Newest Projects": Filter by Public Visibility + Status -> Sort by CreatedAt
    feedNewestIdx: index('projects_feed_newest_idx').on(t.visibility, t.status, t.createdAt),

    // 2. "Most Viewed Projects": Filter by Public Visibility + Status -> Sort by ViewCount
    feedMostViewedIdx: index('projects_feed_most_viewed_idx').on(t.visibility, t.status, t.viewCount),

    // 3. "My Projects": Filter by Owner -> Sort by CreatedAt
    myProjectsIdx: index('projects_my_projects_idx').on(t.ownerId, t.createdAt),
}))

// ============================================================================
// PROJECT MEMBERS TABLE
// ============================================================================
export const projectMembers = pgTable('project_members', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).default('member').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectUserUnique: uniqueIndex('project_members_project_user_unique').on(t.projectId, t.userId),
    projectIdx: index('project_members_project_idx').on(t.projectId),
    userIdx: index('project_members_user_idx').on(t.userId),
}))

// ============================================================================
// OPEN ROLES TABLE
// ============================================================================
export const projectOpenRoles = pgTable('project_open_roles', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // e.g. "Frontend Developer"
    title: text('title'), // Display title
    description: text('description'),
    count: integer('count').default(1).notNull(),
    filled: integer('filled').default(0).notNull(),
    skills: jsonb('skills').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('project_open_roles_project_idx').on(t.projectId),
}))

// ============================================================================
// ROLE APPLICATIONS TABLE
// ============================================================================
export const roleApplications = pgTable('role_applications', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => projectOpenRoles.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id').notNull(), // Denormalized for O(1) creator queries
    message: text('message'), // Application message from user
    conversationId: uuid('conversation_id'), // Link to message thread (nullable)
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).default('pending').notNull(),
    acceptedRoleTitle: text('accepted_role_title'),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    decisionBy: uuid('decision_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    // O(1) lookups for user's applications
    applicantIdx: index('role_applications_applicant_idx').on(t.applicantId, t.status),
    // O(1) lookups for creator's pending applications
    creatorPendingIdx: index('role_applications_creator_pending_idx').on(t.creatorId, t.status),
    // O(1) cooldown check (project + applicant + updated_at)
    cooldownIdx: index('role_applications_cooldown_idx').on(t.projectId, t.applicantId, t.updatedAt),
    // O(1) lookups for project-member role title enrichment.
    acceptedProjectMemberIdx: index('role_applications_accepted_member_idx').on(t.projectId, t.applicantId, t.status, t.updatedAt),
    // Unique constraint: one active application per user per project
    uniqueAppIdx: uniqueIndex('role_applications_unique_idx').on(t.projectId, t.applicantId),
}))

// ============================================================================
// PROJECT FOLLOWS TABLE
// ============================================================================
export const projectFollows = pgTable('project_follows', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('project_follows_project_idx').on(t.projectId),
    userIdx: index('project_follows_user_idx').on(t.userId),
    uniqueFollow: uniqueIndex('project_follows_unique_idx').on(t.projectId, t.userId),
}))

// ============================================================================
// SAVED PROJECTS TABLE
// ============================================================================
export const savedProjects = pgTable('saved_projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    userIdx: index('saved_projects_user_idx').on(t.userId),
    uniqueSave: uniqueIndex('saved_projects_unique_idx').on(t.userId, t.projectId),
}))

// ============================================================================
// SPRINTS TABLE
// ============================================================================
export const projectSprints = pgTable('project_sprints', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: text('goal'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['planning', 'active', 'completed'] }).default('planning').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('project_sprints_project_idx').on(t.projectId),
    statusIdx: index('project_sprints_status_idx').on(t.status),
}))

// ============================================================================
// TASKS TABLE
// ============================================================================
export const tasks = pgTable('tasks', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    sprintId: uuid('sprint_id').references(() => projectSprints.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
    creatorId: uuid('creator_id').references(() => profiles.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['todo', 'in_progress', 'done', 'blocked'] }).default('todo').notNull(),
    priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] }).default('medium').notNull(),

    // Project Key System
    taskNumber: integer('task_number'), // e.g. 12 (displayed as NB-12)

    storyPoints: integer('story_points'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('tasks_project_idx').on(t.projectId),
    sprintIdx: index('tasks_sprint_idx').on(t.sprintId),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId),
    statusIdx: index('tasks_status_idx').on(t.status),
    // Composite indexes for filtering
    projectStatusIdx: index('tasks_project_status_idx').on(t.projectId, t.status),
    projectSprintIdx: index('tasks_project_sprint_idx').on(t.projectId, t.sprintId),
    projectAssigneeIdx: index('tasks_project_assignee_idx').on(t.projectId, t.assigneeId),
    // Optimization: GIN Index for fast title search (Tasks Search Optimization)
    titleSearchIdx: index('tasks_title_search_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    // Optimization: Creator Index for "My Tasks"
    creatorIdx: index('tasks_creator_idx').on(t.creatorId),
    // Optimization: Ordering Index (Tasks Sorting Optimization)
    // Optimized for "ORDER BY task_number DESC" which is default view
    projectNumberIdx: index('tasks_project_number_idx').on(t.projectId, t.taskNumber),
}))

// ============================================================================
// TASK SUBTASKS TABLE
// ============================================================================
export const taskSubtasks = pgTable('task_subtasks', {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    completed: boolean('completed').default(false).notNull(),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    taskIdx: index('task_subtasks_task_idx').on(t.taskId),
}))

// ============================================================================
// PROJECT NODES (FILE SYSTEM)
// ============================================================================
export const projectNodes = pgTable('project_nodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    // Circular ref handled by foreignKey below
    type: text('type', { enum: ['folder', 'file'] }).notNull(),
    name: text('name').notNull(),

    // File specifics
    s3Key: text('s3_key'),
    size: bigint('size', { mode: 'number' }).default(0),
    mimeType: text('mime_type'),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // Audit
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    deletedBy: uuid('deleted_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
    projectIdx: index('project_nodes_project_idx').on(t.projectId),
    parentIdx: index('project_nodes_parent_idx').on(t.parentId),
    // Optimization: Covered Index for listing (Listing Optimization)
    // Allows "Index Only Scan" for getProjectNodes which filters by (projectId, parentId) and sorts by (type, name)
    listingIdx: index('project_nodes_listing_idx').on(t.projectId, t.parentId, t.type, t.name),
    // Self-referencing FK with cascade
    parentFk: foreignKey({
        columns: [t.parentId],
        foreignColumns: [t.id],
    }).onDelete('cascade'),
}))

// ============================================================================
// TASK NODE LINKS (Many-to-Many Task <-> File/Folder)
// ============================================================================
export const taskNodeLinks = pgTable('task_node_links', {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull().references(() => projectNodes.id, { onDelete: 'cascade' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
}, (t) => ({
    taskIdx: index('task_node_links_task_idx').on(t.taskId),
    nodeIdx: index('task_node_links_node_idx').on(t.nodeId),
    uniqueLink: uniqueIndex('task_node_links_unique_idx').on(t.taskId, t.nodeId),
}))

// ============================================================================
// PROJECT FILE INDEX (Find-in-project)
// ============================================================================
export const projectFileIndex = pgTable('project_file_index', {
    nodeId: uuid('node_id').primaryKey().notNull().references(() => projectNodes.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content').default('').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('project_file_index_project_idx').on(t.projectId),
    // Optimization: GIN Index for fast trigram search (Search Optimization)
    // Needs `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in migration
    contentSearchIdx: index('project_file_index_content_search_idx').using('gin', sql`${t.content} gin_trgm_ops`),
}))

// ============================================================================
// PROJECT NODE LOCKS (Soft locks for multi-user editing)
// ============================================================================
export const projectNodeLocks = pgTable('project_node_locks', {
    nodeId: uuid('node_id').primaryKey().notNull().references(() => projectNodes.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    lockedBy: uuid('locked_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
    projectIdx: index('project_node_locks_project_idx').on(t.projectId),
    expiresIdx: index('project_node_locks_expires_idx').on(t.expiresAt),
}))

// ============================================================================
// PROJECT NODE EVENTS (Audit trail)
// ============================================================================
export const projectNodeEvents = pgTable('project_node_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => projectNodes.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('project_node_events_project_idx').on(t.projectId, t.createdAt),
    nodeIdx: index('project_node_events_node_idx').on(t.nodeId, t.createdAt),
}))


// ============================================================================
// ============================================================================
// RELATIONS
// ============================================================================
export const profilesRelations = relations(profiles, ({ many }) => ({
    sentConnections: many(connections, { relationName: 'requester' }),
    receivedConnections: many(connections, { relationName: 'addressee' }),
    projects: many(projects),
    projectMemberships: many(projectMembers),
    followedProjects: many(projectFollows),
    savedProjects: many(savedProjects),
}))

export const connectionsRelations = relations(connections, ({ one }) => ({
    requester: one(profiles, {
        fields: [connections.requesterId],
        references: [profiles.id],
        relationName: 'requester',
    }),
    addressee: one(profiles, {
        fields: [connections.addresseeId],
        references: [profiles.id],
        relationName: 'addressee',
    }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
    owner: one(profiles, {
        fields: [projects.ownerId],
        references: [profiles.id],
    }),
    members: many(projectMembers),
    followers: many(projectFollows),
    saves: many(savedProjects),
    sprints: many(projectSprints),
    tasks: many(tasks),
    openRoles: many(projectOpenRoles),
    nodes: many(projectNodes),
    applications: many(roleApplications),
}))


export const projectOpenRolesRelations = relations(projectOpenRoles, ({ one, many }) => ({
    project: one(projects, {
        fields: [projectOpenRoles.projectId],
        references: [projects.id],
    }),
    applications: many(roleApplications),
}))

export const roleApplicationsRelations = relations(roleApplications, ({ one }) => ({
    project: one(projects, {
        fields: [roleApplications.projectId],
        references: [projects.id],
    }),
    role: one(projectOpenRoles, {
        fields: [roleApplications.roleId],
        references: [projectOpenRoles.id],
    }),
    applicant: one(profiles, {
        fields: [roleApplications.applicantId],
        references: [profiles.id],
        relationName: 'applicant',
    }),
    creator: one(profiles, {
        fields: [roleApplications.creatorId],
        references: [profiles.id],
        relationName: 'applicationCreator',
    }),
    decisionMaker: one(profiles, {
        fields: [roleApplications.decisionBy],
        references: [profiles.id],
        relationName: 'applicationDecisionMaker',
    }),
}))

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
    project: one(projects, {
        fields: [projectMembers.projectId],
        references: [projects.id],
    }),
    user: one(profiles, {
        fields: [projectMembers.userId],
        references: [profiles.id],
    }),
}))

export const projectFollowsRelations = relations(projectFollows, ({ one }) => ({
    project: one(projects, {
        fields: [projectFollows.projectId],
        references: [projects.id],
    }),
    user: one(profiles, {
        fields: [projectFollows.userId],
        references: [profiles.id],
    }),
}))

export const savedProjectsRelations = relations(savedProjects, ({ one }) => ({
    user: one(profiles, {
        fields: [savedProjects.userId],
        references: [profiles.id],
    }),
    project: one(projects, {
        fields: [savedProjects.projectId],
        references: [projects.id],
    }),
}))

export const projectSprintsRelations = relations(projectSprints, ({ one, many }) => ({
    project: one(projects, {
        fields: [projectSprints.projectId],
        references: [projects.id],
    }),
    tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
    project: one(projects, {
        fields: [tasks.projectId],
        references: [projects.id],
    }),
    sprint: one(projectSprints, {
        fields: [tasks.sprintId],
        references: [projectSprints.id],
    }),
    assignee: one(profiles, {
        fields: [tasks.assigneeId],
        references: [profiles.id],
        relationName: 'assignee',
    }),
    creator: one(profiles, {
        fields: [tasks.creatorId],
        references: [profiles.id],
        relationName: 'creator',
    }),
    attachments: many(taskNodeLinks),
    subtasks: many(taskSubtasks),
}))

export const taskSubtasksRelations = relations(taskSubtasks, ({ one }) => ({
    task: one(tasks, {
        fields: [taskSubtasks.taskId],
        references: [tasks.id],
    }),
}))

export const projectNodesRelations = relations(projectNodes, ({ one, many }) => ({
    project: one(projects, {
        fields: [projectNodes.projectId],
        references: [projects.id],
    }),
    parent: one(projectNodes, {
        fields: [projectNodes.parentId],
        references: [projectNodes.id],
        relationName: 'children',
    }),
    children: many(projectNodes, {
        relationName: 'children',
    }),
    creator: one(profiles, {
        fields: [projectNodes.createdBy],
        references: [profiles.id],
    }),
    deleter: one(profiles, {
        fields: [projectNodes.deletedBy],
        references: [profiles.id],
        relationName: 'deleter',
    }),
    linkedTasks: many(taskNodeLinks),
    fileIndex: one(projectFileIndex, {
        fields: [projectNodes.id],
        references: [projectFileIndex.nodeId],
    }),
    lock: one(projectNodeLocks, {
        fields: [projectNodes.id],
        references: [projectNodeLocks.nodeId],
    }),
    events: many(projectNodeEvents),
}))

export const taskNodeLinksRelations = relations(taskNodeLinks, ({ one }) => ({
    task: one(tasks, {
        fields: [taskNodeLinks.taskId],
        references: [tasks.id],
    }),
    node: one(projectNodes, {
        fields: [taskNodeLinks.nodeId],
        references: [projectNodes.id],
    }),
    creator: one(profiles, {
        fields: [taskNodeLinks.createdBy],
        references: [profiles.id],
    }),
}))

export const projectFileIndexRelations = relations(projectFileIndex, ({ one }) => ({
    project: one(projects, {
        fields: [projectFileIndex.projectId],
        references: [projects.id],
    }),
    node: one(projectNodes, {
        fields: [projectFileIndex.nodeId],
        references: [projectNodes.id],
    }),
}))

export const projectNodeLocksRelations = relations(projectNodeLocks, ({ one }) => ({
    project: one(projects, { fields: [projectNodeLocks.projectId], references: [projects.id] }),
    node: one(projectNodes, { fields: [projectNodeLocks.nodeId], references: [projectNodes.id] }),
    user: one(profiles, { fields: [projectNodeLocks.lockedBy], references: [profiles.id] }),
}))

export const projectNodeEventsRelations = relations(projectNodeEvents, ({ one }) => ({
    project: one(projects, { fields: [projectNodeEvents.projectId], references: [projects.id] }),
    node: one(projectNodes, { fields: [projectNodeEvents.nodeId], references: [projectNodes.id] }),
    actor: one(profiles, { fields: [projectNodeEvents.actorId], references: [profiles.id] }),
}))



// Conversations table moved to top
// ============================================================================

// ============================================================================
// DM PAIRS TABLE
// Ensures a single DM conversation per (user_low, user_high) pair.
// ============================================================================
export const dmPairs = pgTable('dm_pairs', {
    userLow: uuid('user_low').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    pairUnique: uniqueIndex('dm_pairs_user_low_high_unique').on(t.userLow, t.userHigh),
    conversationUnique: uniqueIndex('dm_pairs_conversation_unique').on(t.conversationId),
    userLowIdx: index('dm_pairs_user_low_idx').on(t.userLow),
    userHighIdx: index('dm_pairs_user_high_idx').on(t.userHigh),
}))

// ============================================================================
// CONVERSATION PARTICIPANTS TABLE
// ============================================================================
export const conversationParticipants = pgTable('conversation_participants', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow(),
    lastReadMessageId: uuid('last_read_message_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    muted: boolean('muted').default(false),
    // Pure Optimization: Denormalized counts for O(1) badges (1M+ Users)
    unreadCount: integer('unread_count').default(0).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
}, (t) => ({
    conversationUserUnique: uniqueIndex('conversation_participants_unique').on(t.conversationId, t.userId),
    userIdx: index('conversation_participants_user_idx').on(t.userId),
    conversationIdx: index('conversation_participants_conversation_idx').on(t.conversationId),
    // Optimization: O(1) sorted list for "My Conversations" and "Global Badge"
    myConversationsIdx: index('conversation_participants_my_conversations_idx').on(t.userId, t.lastMessageAt),
    activeIdx: index('conversation_participants_active_idx').on(t.userId, t.archivedAt, t.lastMessageAt),
}))

// ============================================================================
// MESSAGES TABLE
// ============================================================================
export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'set null' }),
    replyToMessageId: uuid('reply_to_message_id'),
    clientMessageId: text('client_message_id'),
    content: text('content'),
    type: text('type', { enum: ['text', 'image', 'video', 'file', 'system'] }).default('text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
    conversationCreatedIdx: index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    // Optimization: GIN Index for fast full-text search (Messages Search Optimization)
    contentSearchIdx: index('messages_content_search_idx').using('gin', sql`to_tsvector('english', coalesce(${t.content}, ''))`),
    contentTrgmSearchIdx: index('messages_content_trgm_idx').using('gin', sql`${t.content} gin_trgm_ops`),
    // Optimization: Sender Index for lookups
    senderIdx: index('messages_sender_idx').on(t.senderId),
    senderCreatedIdx: index('messages_sender_created_idx').on(t.senderId, t.createdAt),
    replyIdx: index('messages_reply_idx').on(t.replyToMessageId),
    conversationReplyCreatedIdx: index('messages_conversation_reply_created_idx').on(t.conversationId, t.replyToMessageId, t.createdAt),
    idempotencyUnique: uniqueIndex('messages_conversation_sender_client_unique').on(t.conversationId, t.senderId, t.clientMessageId),
    replyToFk: foreignKey({
        columns: [t.replyToMessageId],
        foreignColumns: [t.id],
        name: 'messages_reply_to_message_id_fkey',
    }).onDelete('set null'),
}))

// ============================================================================
// MESSAGE ATTACHMENTS TABLE
// ============================================================================
export const messageAttachments = pgTable('message_attachments', {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['image', 'video', 'file'] }).notNull(),
    storagePath: text('storage_path'),
    url: text('url').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes'),
    mimeType: text('mime_type'),
    thumbnailUrl: text('thumbnail_url'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    messageIdx: index('message_attachments_message_idx').on(t.messageId),
}))

// ============================================================================
// MESSAGE USER HIDDEN STATE (Delete-for-me support)
// ============================================================================
export const messageHiddenForUsers = pgTable('message_hidden_for_users', {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    messageUserUnique: uniqueIndex('message_hidden_for_users_unique').on(t.messageId, t.userId),
    userIdx: index('message_hidden_for_users_user_idx').on(t.userId, t.hiddenAt),
    messageIdx: index('message_hidden_for_users_message_idx').on(t.messageId),
}))

// ============================================================================
// MESSAGE EDIT LOGS (Audit trail)
// ============================================================================
export const messageEditLogs = pgTable('message_edit_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    editorId: uuid('editor_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    previousContent: text('previous_content'),
    nextContent: text('next_content'),
    editedAt: timestamp('edited_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    messageEditedIdx: index('message_edit_logs_message_idx').on(t.messageId, t.editedAt),
    editorIdx: index('message_edit_logs_editor_idx').on(t.editorId, t.editedAt),
}))

// ============================================================================
// ATTACHMENT UPLOAD SESSIONS (Reliability / Resume-Aware Tracking)
// ============================================================================
export const attachmentUploads = pgTable('attachment_uploads', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    clientUploadId: text('client_upload_id').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    storagePath: text('storage_path'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    status: text('status', {
        enum: ['queued', 'uploading', 'uploaded', 'committed', 'failed', 'canceled'],
    }).default('queued').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => ({
    userClientUnique: uniqueIndex('attachment_uploads_user_client_unique').on(t.userId, t.clientUploadId),
    userStatusIdx: index('attachment_uploads_user_status_idx').on(t.userId, t.status, t.updatedAt),
    storagePathIdx: index('attachment_uploads_storage_path_idx').on(t.storagePath),
    conversationIdx: index('attachment_uploads_conversation_idx').on(t.conversationId, t.updatedAt),
}))

// ============================================================================
// MESSAGING RELATIONS
// ============================================================================
export const conversationsRelations = relations(conversations, ({ many }) => ({
    participants: many(conversationParticipants),
    messages: many(messages),
}))

export const dmPairsRelations = relations(dmPairs, ({ one }) => ({
    conversation: one(conversations, {
        fields: [dmPairs.conversationId],
        references: [conversations.id],
    }),
    userLow: one(profiles, {
        fields: [dmPairs.userLow],
        references: [profiles.id],
        relationName: 'dmPairUserLow',
    }),
    userHigh: one(profiles, {
        fields: [dmPairs.userHigh],
        references: [profiles.id],
        relationName: 'dmPairUserHigh',
    }),
}))

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
    conversation: one(conversations, {
        fields: [conversationParticipants.conversationId],
        references: [conversations.id],
    }),
    user: one(profiles, {
        fields: [conversationParticipants.userId],
        references: [profiles.id],
    }),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
    conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id],
    }),
    sender: one(profiles, {
        fields: [messages.senderId],
        references: [profiles.id],
    }),
    replyTo: one(messages, {
        fields: [messages.replyToMessageId],
        references: [messages.id],
        relationName: 'message_reply_reference',
    }),
    replies: many(messages, {
        relationName: 'message_reply_reference',
    }),
    attachments: many(messageAttachments),
}))

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
    message: one(messages, {
        fields: [messageAttachments.messageId],
        references: [messages.id],
    }),
}))

// ============================================================================
// TYPE EXPORTS
// ============================================================================
export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
export type Connection = typeof connections.$inferSelect
export type NewConnection = typeof connections.$inferInsert
export type ConnectionSuggestionDismissal = typeof connectionSuggestionDismissals.$inferSelect
export type NewConnectionSuggestionDismissal = typeof connectionSuggestionDismissals.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert
export type ProjectFollow = typeof projectFollows.$inferSelect
export type NewProjectFollow = typeof projectFollows.$inferInsert
export type SavedProject = typeof savedProjects.$inferSelect
export type NewSavedProject = typeof savedProjects.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type DmPair = typeof dmPairs.$inferSelect
export type NewDmPair = typeof dmPairs.$inferInsert
export type ConversationParticipant = typeof conversationParticipants.$inferSelect
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type MessageAttachment = typeof messageAttachments.$inferSelect
export type NewMessageAttachment = typeof messageAttachments.$inferInsert
export type MessageHiddenForUser = typeof messageHiddenForUsers.$inferSelect
export type NewMessageHiddenForUser = typeof messageHiddenForUsers.$inferInsert
export type MessageEditLog = typeof messageEditLogs.$inferSelect
export type NewMessageEditLog = typeof messageEditLogs.$inferInsert
export type AttachmentUpload = typeof attachmentUploads.$inferSelect
export type NewAttachmentUpload = typeof attachmentUploads.$inferInsert

export type TaskSubtask = typeof taskSubtasks.$inferSelect
export type NewTaskSubtask = typeof taskSubtasks.$inferInsert

export type ProjectNode = typeof projectNodes.$inferSelect
export type NewProjectNode = typeof projectNodes.$inferInsert
export type TaskNodeLink = typeof taskNodeLinks.$inferSelect
export type NewTaskNodeLink = typeof taskNodeLinks.$inferInsert
