export type GithubImportAccessState = {
  linked: boolean;
  username: string | null;
  repoAccess: boolean;
  refreshRequired: boolean;
  sealedImportToken: unknown | null;
};

export type GithubImportRepoItem = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  visibility: "public" | "private";
  defaultBranch: string | null;
  description: string | null;
  updatedAt: string | null;
};

export type GithubImportPreviewEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number | null;
  excludedReason?: "ignored" | "tooLarge";
};
