export type TopNavAuthUiState = "loading" | "signed-in" | "signed-out";

export function resolveTopNavAuthUiState(input: {
  isAuthenticated: boolean;
  isLoading: boolean;
}): TopNavAuthUiState {
  if (input.isLoading) {
    return "loading";
  }

  return input.isAuthenticated ? "signed-in" : "signed-out";
}
