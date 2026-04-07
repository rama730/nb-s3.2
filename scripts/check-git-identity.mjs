#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

function readGitConfig(key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const name = readGitConfig('user.name');
const email = readGitConfig('user.email');

const problems = [];

if (!name) {
  problems.push('git user.name is not configured');
}

if (!email) {
  problems.push('git user.email is not configured');
}

if (email) {
  const hasEmailShape = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const usesBlockedHost =
    /\.local$/i.test(email) ||
    /@localhost$/i.test(email) ||
    /@(example\.com|example\.org|example\.net)$/i.test(email);

  if (!hasEmailShape) {
    problems.push(`git user.email is not a valid email address: ${email}`);
  }

  if (usesBlockedHost) {
    problems.push(`git user.email uses a non-attributable local or placeholder domain: ${email}`);
  }
}

if (problems.length > 0) {
  console.error('[git-identity] Commit blocked.');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  console.error('');
  console.error('Set a verified GitHub email or your GitHub noreply email before committing.');
  process.exit(1);
}

console.log(`[git-identity] OK: ${name} <${email}>`);
