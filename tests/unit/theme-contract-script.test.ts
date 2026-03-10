import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateThemeContract } from "../../scripts/check-theme-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-theme-contract script", () => {
  it("passes when next-themes import is isolated to canonical provider", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "theme-contract-pass-"));
    write(
      path.join(tmp, "src/components/providers/theme-provider.tsx"),
      `import { useTheme as useNextTheme } from "next-themes"; export const x = useNextTheme;`,
    );
    write(path.join(tmp, "src/components/layout/header/ThemeToggle.tsx"), `export default function X(){ return null; }`);

    const result = validateThemeContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails for direct next-themes imports and legacy provider file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "theme-contract-fail-"));
    write(
      path.join(tmp, "src/components/providers/theme-provider.tsx"),
      `import { useTheme as useNextTheme } from "next-themes"; export const x = useNextTheme;`,
    );
    write(
      path.join(tmp, "src/components/ui/sonner.tsx"),
      `import { useTheme } from "next-themes"; export const y = useTheme;`,
    );
    write(path.join(tmp, "src/components/theme/ThemeProvider.tsx"), `export default function Legacy(){ return null; }`);

    const result = validateThemeContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("imports next-themes directly")));
    assert.ok(result.errors.some((line) => line.includes("Legacy provider file must not exist")));
  });
});
