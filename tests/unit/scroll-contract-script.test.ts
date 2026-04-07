import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateScrollContract } from "../../scripts/check-scroll-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-scroll-contract script", () => {
  it("passes a valid minimal project", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scroll-contract-pass-"));
    write(path.join(tmp, "src/app/globals.css"), ".app-scroll { scrollbar-width: thin; }");
    write(path.join(tmp, "src/app/(main)/foo/page.tsx"), `<div data-scroll-root="route" />`);
    write(path.join(tmp, "src/app/(main)/layout.tsx"), `export default function L({children}:{children:React.ReactNode}){return children}`);

    const result = validateScrollContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when marker contract and global rules are violated", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scroll-contract-fail-"));
    write(path.join(tmp, "src/app/globals.css"), `*::-webkit-scrollbar{width:6px;} * { scrollbar-color: red blue; }`);
    write(path.join(tmp, "src/app/(main)/foo/layout.tsx"), `<div data-scroll-root="route">{children}</div>`);
    write(path.join(tmp, "src/app/(main)/foo/page.tsx"), `<div data-scroll-root="route" className="custom-scrollbar" />`);

    const result = validateScrollContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("exactly one route scroll root marker")));
    assert.ok(result.errors.some((line) => line.includes("Forbidden global scrollbar selector")));
    assert.ok(result.errors.some((line) => line.includes("Legacy scrollbar utility")));
  });

  it("fails when global smooth scroll is enabled without the html data attribute", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scroll-contract-smooth-"));
    write(path.join(tmp, "src/app/globals.css"), `html { scroll-behavior: smooth; }`);
    write(path.join(tmp, "src/app/layout.tsx"), `export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}`);
    write(path.join(tmp, "src/app/(main)/foo/page.tsx"), `<div data-scroll-root="route" />`);
    write(path.join(tmp, "src/app/(main)/layout.tsx"), `export default function L({children}:{children:React.ReactNode}){return children}`);

    const result = validateScrollContract(tmp);
    assert.ok(
      result.errors.some((line) => line.includes("data-scroll-behavior=\"smooth\"")),
      `Expected smooth-scroll html contract violation, got: ${result.errors.join("\n")}`,
    );
  });
});
