import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  INNGEST_EXECUTION_ROLE: process.env.INNGEST_EXECUTION_ROLE,
  NODE_ENV: process.env.NODE_ENV,
};

async function loadRegistry() {
  return import("@/inngest/registry");
}

beforeEach(() => {
  mutableEnv.DATABASE_URL = originalEnv.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres";
  mutableEnv.NEXT_PUBLIC_SUPABASE_URL = originalEnv.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
  mutableEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key";
  mutableEnv.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY || "service-role-key";
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }
});

describe("inngest registry", () => {
  it("registers no functions in web execution mode", async () => {
    mutableEnv.INNGEST_EXECUTION_ROLE = "web";
    const { getInngestExecutionRole, getRegisteredInngestFunctions } = await loadRegistry();

    assert.equal(getInngestExecutionRole(), "web");
    assert.equal(getRegisteredInngestFunctions().length, 0);
  });

  it("registers worker functions in worker mode", async () => {
    mutableEnv.INNGEST_EXECUTION_ROLE = "worker";
    const { getRegisteredInngestFunctions, WORKER_ONLY_FUNCTION_IDS } = await loadRegistry();

    assert.equal(getRegisteredInngestFunctions().length, WORKER_ONLY_FUNCTION_IDS.length);
  });

  it("requires an explicit production execution role", async () => {
    delete mutableEnv.INNGEST_EXECUTION_ROLE;
    mutableEnv.NODE_ENV = "production";
    const { getInngestExecutionRole } = await loadRegistry();

    assert.throws(
      () => getInngestExecutionRole(),
      /INNGEST_EXECUTION_ROLE must be explicitly set in production/,
    );
  });
});
