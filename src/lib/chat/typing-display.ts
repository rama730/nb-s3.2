export type TypingDisplayUser = {
  id: string;
  username: string | null;
  fullName: string | null;
};

export function getTypingDisplayName(user: TypingDisplayUser) {
  return user.fullName || user.username || "Someone";
}

export function getTypingStatusText(
  users: ReadonlyArray<TypingDisplayUser>,
  options: { ellipsis?: boolean } = {},
) {
  if (users.length === 0) return null;

  const suffix = options.ellipsis ? "..." : "";
  const primaryName = getTypingDisplayName(users[0]);
  if (users.length === 1) {
    return `${primaryName} is typing${suffix}`;
  }

  if (users.length === 2) {
    return `${primaryName} and ${getTypingDisplayName(users[1])} are typing${suffix}`;
  }

  return `${primaryName} and ${users.length - 1} others are typing${suffix}`;
}
