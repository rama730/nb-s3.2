import { pgTable, uuid, text, timestamp, boolean, jsonb, index, integer, bigint, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'


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
}, (t) => ({
    // Optimize lookups by username (common in URLs) and email (auth)
    usernameIdx: index('profiles_username_idx').on(t.username),
    emailIdx: index('profiles_email_idx').on(t.email),
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
}))

// ============================================================================
// PROJECTS TABLE
// ============================================================================
export const projects = pgTable('projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').unique(),
    description: text('description'),
    problemStatement: text('problem_statement'),
    solutionStatement: text('solution_statement'),
    shortDescription: text('short_description'),
    coverImage: text('cover_image'),
    category: text('category'),
    viewCount: integer('view_count').default(0),
    tags: jsonb('tags').$type<string[]>().default([]),
    skills: jsonb('skills').$type<string[]>().default([]),
    visibility: text('visibility', { enum: ['public', 'private', 'unlisted'] }).default('public'),
    status: text('status', { enum: ['draft', 'active', 'completed', 'archived'] }).default('draft'),
    lookingForCollaborators: boolean('looking_for_collaborators').default(false),
    maxCollaborators: text('max_collaborators'),
    lifecycleStages: jsonb('lifecycle_stages').$type<string[]>().default([]),
    currentStageIndex: integer('current_stage_index').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    ownerIdx: index('projects_owner_idx').on(t.ownerId),
    createdAtIdx: index('projects_created_at_idx').on(t.createdAt),
    // Multi-column indexes for filtering (critical for 1M users)
    statusVisibilityIdx: index('projects_status_visibility_idx').on(t.status, t.visibility),
    categoryStatusIdx: index('projects_category_status_idx').on(t.category, t.status),
    // Sort index for the main "Newest Projects" feed
    createdAtStatusIdx: index('projects_created_at_status_idx').on(t.createdAt, t.status),
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
    uniqueFollow: index('project_follows_unique_idx').on(t.projectId, t.userId),
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
    uniqueSave: index('saved_projects_unique_idx').on(t.userId, t.projectId),
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
    storyPoints: integer('story_points'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    projectIdx: index('tasks_project_idx').on(t.projectId),
    sprintIdx: index('tasks_sprint_idx').on(t.sprintId),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId),
    statusIdx: index('tasks_status_idx').on(t.status),
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
    folderContentIdx: index('project_nodes_folder_content_idx').on(t.projectId, t.parentId),
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
    uniqueLink: index('task_node_links_unique_idx').on(t.taskId, t.nodeId),
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
}))


export const projectOpenRolesRelations = relations(projectOpenRoles, ({ one }) => ({
    project: one(projects, {
        fields: [projectOpenRoles.projectId],
        references: [projects.id],
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



// ============================================================================
// CONVERSATIONS TABLE
// ============================================================================
export const conversations = pgTable('conversations', {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['dm', 'group'] }).default('dm').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================================
// CONVERSATION PARTICIPANTS TABLE
// ============================================================================
export const conversationParticipants = pgTable('conversation_participants', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow(),
    muted: boolean('muted').default(false),
}, (t) => ({
    conversationUserUnique: index('conversation_participants_unique').on(t.conversationId, t.userId),
    userIdx: index('conversation_participants_user_idx').on(t.userId),
    conversationIdx: index('conversation_participants_conversation_idx').on(t.conversationId),
}))

// ============================================================================
// MESSAGES TABLE
// ============================================================================
export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'set null' }),
    content: text('content'),
    type: text('type', { enum: ['text', 'image', 'video', 'file', 'system'] }).default('text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
    conversationCreatedIdx: index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
}))

// ============================================================================
// MESSAGE ATTACHMENTS TABLE
// ============================================================================
export const messageAttachments = pgTable('message_attachments', {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['image', 'video', 'file'] }).notNull(),
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
// MESSAGING RELATIONS
// ============================================================================
export const conversationsRelations = relations(conversations, ({ many }) => ({
    participants: many(conversationParticipants),
    messages: many(messages),
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
export type ConversationParticipant = typeof conversationParticipants.$inferSelect
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type MessageAttachment = typeof messageAttachments.$inferSelect
export type NewMessageAttachment = typeof messageAttachments.$inferInsert

export type ProjectNode = typeof projectNodes.$inferSelect
export type NewProjectNode = typeof projectNodes.$inferInsert
export type TaskNodeLink = typeof taskNodeLinks.$inferSelect
export type NewTaskNodeLink = typeof taskNodeLinks.$inferInsert

