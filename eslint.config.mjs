import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "src/app/actions/files.ts",
      "src/app/actions/runner.ts",
      "src/components/projects/intelligence/ProjectIntelligenceProvider.tsx",
      "src/components/projects/v2/FileEditor.tsx",
      "src/components/projects/v2/FileTreePicker.tsx",
      "src/components/projects/v2/ProjectFilesWorkspace.tsx",
      "src/components/projects/v2/navigation/BreadcrumbBar.tsx",
      "src/components/projects/v2/explorer/**/*.tsx",
      "src/components/projects/v2/preview/**/*.tsx",
      "src/components/projects/v2/runner/**/*.tsx",
      "src/components/auth/**/*.tsx",
      "src/components/chat/**/*.tsx",
      "src/components/hub/**/*.tsx",
      "src/components/people/**/*.tsx",
      "src/components/settings/**/*.tsx",
      "src/components/workspace/**/*.tsx",
      "src/app/(main)/settings/account/page.tsx",
      "src/app/api/v1/projects/route.ts",
      "src/app/actions/connections.ts",
      "src/app/actions/messaging.ts",
      "src/hooks/useChatRealtime.ts",
      "src/hooks/useConnections.ts",
      "src/hooks/useConnectionsData.ts",
      "src/hooks/useMessagesData.ts",
      "src/hooks/useTypingChannel.ts",
      "src/lib/runner/**/*.ts",
      "src/hooks/useWorkspaceLayout.ts",
      "src/stores/filesWorkspaceStore.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@next/next/no-img-element": "warn",
      "jsx-a11y/alt-text": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  {
    files: ["scripts/**/*.{js,ts,cjs,mjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
