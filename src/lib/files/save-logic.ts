export function isNoOpSave(content: string, savedSnapshot: string): boolean {
  return content === savedSnapshot;
}

export function resolvePostSaveState(params: {
  savedContent: string;
  currentContent: string;
}): {
  isDirty: boolean;
  savedSnapshot: string;
} {
  const { savedContent, currentContent } = params;
  if (currentContent === savedContent) {
    return {
      isDirty: false,
      savedSnapshot: currentContent,
    };
  }
  return {
    isDirty: true,
    savedSnapshot: savedContent,
  };
}
