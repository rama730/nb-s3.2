export type ConversationRefreshReason =
  | "participant_membership"
  | "participant_unread_delta"
  | "message_unknown"
  | "visibility_change";

export type MessageRefreshReason =
  | "message_update_miss"
  | "attachment_change"
  | "visibility_change";

export type WorkspaceRefreshTarget =
  | "overviewBase"
  | "overviewTasks"
  | "overviewMentions"
  | "tasks"
  | "inbox"
  | "activity";
