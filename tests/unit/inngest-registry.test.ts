import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

import {
  getRegisteredInngestFunctions,
} from "../../src/inngest/registry";

const env = process.env as Record<string, string | undefined>;
const originalExecutionRole = env.INNGEST_EXECUTION_ROLE;
const originalNodeEnv = env.NODE_ENV;
const originalDatabaseUrl = env.DATABASE_URL;
const originalSupabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalSupabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const commonJsModule = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalModuleLoad = commonJsModule._load;

commonJsModule._load = (request: string, ...args: unknown[]) => {
  if (request === "server-only") return {};
  return originalModuleLoad(request, ...args);
};

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

function seedWorkerRegistryEnv() {
  env.DATABASE_URL = env.DATABASE_URL ?? "postgres://user:password@127.0.0.1:5432/edge_test";
  env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key";
  env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "service-role-key";
}

function inngestFunctionIds(functions: ReturnType<typeof getRegisteredInngestFunctions>) {
  return functions
    .map((fn) => typeof fn.id === "function" ? fn.id() : fn.id)
    .sort();
}

afterEach(() => {
  restoreEnv("INNGEST_EXECUTION_ROLE", originalExecutionRole);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NEXT_PUBLIC_SUPABASE_URL", originalSupabaseUrl);
  restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", originalSupabaseAnonKey);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalSupabaseServiceRoleKey);
});

test("getRegisteredInngestFunctions returns no worker functions for web role", () => {
  const functions = getRegisteredInngestFunctions("web");
  assert.deepEqual(functions, []);
});

test("getRegisteredInngestFunctions returns the expected worker function entries for worker role", () => {
  seedWorkerRegistryEnv();
  const functions = getRegisteredInngestFunctions("worker");
  const functionIds = inngestFunctionIds(functions);

  assert.equal(functions.length, functionIds.length);
  assert.deepEqual(functionIds, inngestFunctionIds(getRegisteredInngestFunctions("worker")));
});

test("getRegisteredInngestFunctions defaults to worker registration when INNGEST_EXECUTION_ROLE is unset outside production", () => {
  seedWorkerRegistryEnv();
  delete env.INNGEST_EXECUTION_ROLE;
  env.NODE_ENV = "test";

  const functions = getRegisteredInngestFunctions();

  assert.equal(functions.length, getRegisteredInngestFunctions("worker").length);
});

test("getRegisteredInngestFunctions respects INNGEST_EXECUTION_ROLE when it is set to web", () => {
  env.INNGEST_EXECUTION_ROLE = "web";
  env.NODE_ENV = "production";

  const functions = getRegisteredInngestFunctions();

  assert.deepEqual(functions, []);
});

test("getRegisteredInngestFunctions throws in production when INNGEST_EXECUTION_ROLE is not set", () => {
  delete env.INNGEST_EXECUTION_ROLE;
  env.NODE_ENV = "production";

  assert.throws(
    () => getRegisteredInngestFunctions(),
    /INNGEST_EXECUTION_ROLE must be explicitly set in production\./,
  );
});

test("Inngest API route honors the configured execution role", () => {
  const routeSource = readFileSync(
    path.resolve(__dirname, "../../src/app/api/v1/inngest/route.ts"),
    "utf8",
  );

  assert.match(
    routeSource,
    /functions:\s*getRegisteredInngestFunctions\(\s*\)/,
    "the Inngest route must use the configured/default execution role",
  );
  assert.doesNotMatch(
    routeSource,
    /getRegisteredInngestFunctions\(\s*["']web["']\s*\)/,
    "the Inngest route must not hard-code the web role and drop worker functions",
  );
});
