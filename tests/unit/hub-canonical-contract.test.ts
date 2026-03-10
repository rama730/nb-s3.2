import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateHubCanonicalContract } from "../../scripts/check-hub-canonical-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-hub-canonical-contract script", () => {
  it("passes when no legacy file/import exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-canonical-pass-"));
    write(path.join(tmp, "src/components/hub/SimpleHubClient.tsx"), "export default function S(){return null;}");
    write(path.join(tmp, "src/app/(main)/hub/page.tsx"), `import S from "@/components/hub/SimpleHubClient"; export default S;`);

    const result = validateHubCanonicalContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when legacy hub client exists or is imported", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-canonical-fail-"));
    write(path.join(tmp, "src/components/hub/HubClient.tsx"), "export default function H(){return null;}");
    write(path.join(tmp, "src/app/(main)/hub/page.tsx"), `import H from "@/components/hub/HubClient"; export default H;`);

    const result = validateHubCanonicalContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("legacy HubClient implementation must not exist")));
    assert.ok(result.errors.some((line) => line.includes("importing legacy HubClient is forbidden")));
  });
});
