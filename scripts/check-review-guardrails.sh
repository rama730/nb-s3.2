#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failed=0

echo "Checking accidental review artifacts..."
if [[ -f review.txt ]]; then
  echo "review.txt exists in the repo root. Remove it from commits."
  failed=1
fi
if [[ -f eslint_output.txt ]]; then
  echo "eslint_output.txt exists in the repo root. Remove it from commits."
  failed=1
fi

echo "Checking for broad 500 console suppression in E2E specs..."
if rg -n '/[^\n]*(500|Internal Server Error|5\\d\\d)[^\n]*/' tests/e2e --glob '*.spec.ts' >/tmp/review_guardrails_500.log; then
  cat /tmp/review_guardrails_500.log
  echo "Found broad 5xx suppression/message patterns in E2E specs."
  failed=1
fi

echo "Checking for risky console format-string patterns (template first arg + extra args)..."
if rg -n 'console\.(log|info|warn|error|debug)\s*\(\s*`[^`]*\$\{[^`]+\}[^`]*`\s*,' \
  scripts/backfill.ts \
  scripts/check-project.ts \
  scripts/migrate-task-files-to-project-files.ts \
  src/components/profile/edit/EditProfileTabs.tsx \
  src/components/projects/TabErrorBoundary.tsx \
  src/components/projects/v2/explorer/utils/download.worker.ts \
  src/inngest/functions/flush-views.ts \
  src/inngest/functions/git-sync.ts \
  src/inngest/functions/project-files-key-migration.ts \
  src/inngest/functions/project-import.ts \
  src/lib/data/project.ts \
  src/lib/import/utils.ts \
  src/lib/logger.ts \
  src/lib/security/rate-limit.ts \
  src/lib/upload/chunked-upload.ts \
  src/lib/utils/cache-manager.ts >/tmp/review_guardrails_console_templates.log; then
  cat /tmp/review_guardrails_console_templates.log
  echo "Found risky console format-string patterns."
  failed=1
fi

echo "Checking for shell execution in server/runtime code..."
if rg -n 'shell:\s*true' src/app src/inngest scripts --glob '!scripts/check-review-guardrails.sh' >/tmp/review_guardrails_shell_true.log; then
  cat /tmp/review_guardrails_shell_true.log
  echo "Found shell:true process execution."
  failed=1
fi

echo "Checking for unsafe path join patterns in critical modules..."
if rg -n 'join\(__dirname,\s*"\.\.",\s*path\)|join\(tmpDir,\s*baseName\)|join\(dir,\s*entry\)|join\(tempDir,\s*filePath\)|path\.join\(dir,\s*entry\.name\)' \
  scripts/apply-files-migrations.ts \
  src/app/actions/lint.ts \
  src/inngest/functions/git-sync.ts \
  src/lib/import/utils.ts >/tmp/review_guardrails_path_join.log; then
  cat /tmp/review_guardrails_path_join.log
  echo "Found unsafe path join patterns in critical modules."
  failed=1
fi

echo "Checking for silent catch blocks in critical paths..."
if rg -n 'catch\s*\{\s*\}' src/app/actions src/components/hub src/inngest scripts >/tmp/review_guardrails_empty_catch.log; then
  cat /tmp/review_guardrails_empty_catch.log
  echo "Found empty catch blocks."
  failed=1
fi
if rg -n 'catch\(\s*\)\s*=>\s*\{\s*\}' src/app/actions src/components/hub src/inngest scripts >/tmp/review_guardrails_empty_promise_catch.log; then
  cat /tmp/review_guardrails_empty_promise_catch.log
  echo "Found empty promise catch handlers."
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  echo "Guardrail checks failed."
  exit 1
fi

echo "Guardrail checks passed."
