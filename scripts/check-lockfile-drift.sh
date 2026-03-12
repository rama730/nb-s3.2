#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package-lock.json ]]; then
  echo "[deps] package-lock.json is missing." >&2
  exit 1
fi

before_hash="$(shasum package-lock.json | awk '{print $1}')"
npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
after_hash="$(shasum package-lock.json | awk '{print $1}')"

if [[ "$before_hash" != "$after_hash" ]]; then
  echo "[deps] package-lock.json drift detected. Run 'npm install' and commit the lockfile changes." >&2
  exit 1
fi

echo "[deps] package-lock.json is up to date."
