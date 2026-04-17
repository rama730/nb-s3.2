import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const nextConfig = await readFile(path.join(root, "next.config.ts"), "utf8");
  const routeSource = await readFile(path.join(root, "src/app/api/e2e/auth/route.ts"), "utf8");
  const disabledSource = await readFile(path.join(root, "src/app/api/e2e/auth/route.disabled.ts"), "utf8");
  const devSource = await readFile(path.join(root, "src/app/api/e2e/auth/route.dev.ts"), "utf8");

  const checks: Array<[string, boolean]> = [
    ["route.ts must re-export the aliased implementation", routeSource.includes('export { DELETE, POST } from "@/app/api/e2e/auth/route-impl";')],
    [
      "next.config.ts must alias the E2E auth implementation",
      nextConfig.includes('"@/app/api/e2e/auth/route-impl": e2eAuthRouteImplRelativePath')
        && nextConfig.includes('"@/app/api/e2e/auth/route-impl": e2eAuthRouteImplAbsolutePath'),
    ],
    ["production must resolve E2E auth to the disabled stub", nextConfig.includes('route.disabled.ts')],
    ["development must resolve E2E auth to the dev implementation", nextConfig.includes('route.dev.ts')],
    ["disabled route must always return 404", disabledSource.includes('status: 404')],
    ["dev route must contain the privileged implementation", devSource.includes('createE2EAuthClient') && devSource.includes('signInWithPassword')],
  ];

  const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failures.length > 0) {
    throw new Error(`E2E auth bundle contract failed: ${failures.join(", ")}`);
  }

  console.log("[e2e-auth-bundle-contract] ok");
}

main().catch((error) => {
  console.error("[e2e-auth-bundle-contract] failed:", error);
  process.exit(1);
});
