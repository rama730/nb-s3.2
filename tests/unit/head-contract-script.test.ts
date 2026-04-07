import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateHeadContract } from "../../scripts/check-head-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-head-contract script", () => {
  it("passes when root metadata ownership and theme-color ownership are isolated", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "head-contract-pass-"));
    write(
      path.join(tmp, "src/app/layout.tsx"),
      `export const metadata = { metadataBase: new URL("https://edge.test") }; export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" data-scroll-behavior="smooth"><head><meta name="theme-color" content="#fff" data-app-theme-color="true" /></head><body>{children}</body></html>}`,
    );
    write(
      path.join(tmp, "src/components/providers/theme-provider.tsx"),
      `const meta = document.querySelector('meta[data-app-theme-color="true"]')`,
    );
    write(
      path.join(tmp, "src/lib/theme/appearance.ts"),
      `const meta = document.querySelector('meta[data-app-theme-color="true"]')`,
    );

    const result = validateHeadContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when root layout owns page metadata keys or theme-color selection is mixed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "head-contract-fail-"));
    write(
      path.join(tmp, "src/app/layout.tsx"),
      `export const metadata = { title: "Edge", description: "Bad", openGraph: {}, metadataBase: new URL("https://edge.test") }; export default function RootLayout({children}:{children:React.ReactNode}){return <html><head><meta name="theme-color" content="#fff" /><meta name="theme-color" content="#000" data-app-theme-color="true" /></head><body>{children}</body></html>}`,
    );
    write(
      path.join(tmp, "src/components/providers/theme-provider.tsx"),
      `const meta = document.querySelector('meta[name="theme-color"]')`,
    );
    write(
      path.join(tmp, "src/lib/theme/appearance.ts"),
      `const meta = document.querySelector('meta[name="theme-color"]')`,
    );

    const result = validateHeadContract(tmp);
    assert.ok(result.errors.some((line) => line.includes('must not own page metadata key "title"')));
    assert.ok(result.errors.some((line) => line.includes('must not own page metadata key "description"')));
    assert.ok(result.errors.some((line) => line.includes('must not own page metadata key "openGraph"')));
    assert.ok(result.errors.some((line) => line.includes("theme-provider.tsx must target")));
    assert.ok(result.errors.some((line) => line.includes("appearance.ts must target")));
  });
});
