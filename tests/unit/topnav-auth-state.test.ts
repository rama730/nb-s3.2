import test from "node:test";
import assert from "node:assert/strict";

import { resolveTopNavAuthUiState } from "@/components/layout/header/topnav-auth-state";

test("resolveTopNavAuthUiState keeps unresolved auth in loading state", () => {
  assert.equal(
    resolveTopNavAuthUiState({
      isAuthenticated: false,
      isLoading: true,
    }),
    "loading",
  );
});

test("resolveTopNavAuthUiState returns signed-in once auth is resolved", () => {
  assert.equal(
    resolveTopNavAuthUiState({
      isAuthenticated: true,
      isLoading: false,
    }),
    "signed-in",
  );
});

test("resolveTopNavAuthUiState returns signed-out only after auth resolution", () => {
  assert.equal(
    resolveTopNavAuthUiState({
      isAuthenticated: false,
      isLoading: false,
    }),
    "signed-out",
  );
});
