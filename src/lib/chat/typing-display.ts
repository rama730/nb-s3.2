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
  const primaryName = users[0] ? getTypingDisplayName(users[0]) : "Someone";
  if (users.length === 1) {
    return `${primaryName} is typing${suffix}`;
  }

  if (users.length === 2) {
    const secondName = users[1] ? getTypingDisplayName(users[1]) : "Someone";
    return `${primaryName} and ${secondName} are typing${suffix}`;
  }

  return `${primaryName} and ${users.length - 1} others are typing${suffix}`;
}
