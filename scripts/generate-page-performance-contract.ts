import path from "node:path";

function normalizeRoute(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("route is required, example: /projects/[slug]");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function routeToPageFile(routeId: string): string {
  if (routeId === "/") return "src/app/page.tsx";
  return path.posix.join("src/app", routeId, "page.tsx");
}

function main() {
  const routeId = normalizeRoute(process.argv[2] || "");
  const pageFile = routeToPageFile(routeId);

  const template = {
    routeId,
    pageFile,
    renderingMode: "revalidate",
    routeClass: "user_shell",
    cacheStrategy: "request",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxBackgroundChannels: 1,
    overloadMode: "fail_closed",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  };

  console.log(JSON.stringify(template, null, 2));
}

main();
