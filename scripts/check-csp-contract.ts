import fs from "node:fs";
import path from "node:path";

function assertIncludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function main() {
  const root = process.cwd();
  const middlewarePath = path.join(root, "middleware.ts");
  const layoutPath = path.join(root, "src/app/layout.tsx");
  const providerPath = path.join(root, "src/components/providers/SecurityRuntimeProvider.tsx");
  const turnstilePath = path.join(root, "src/components/auth/TurnstileWidget.tsx");

  const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
  const layoutSource = fs.readFileSync(layoutPath, "utf8");
  const providerSource = fs.readFileSync(providerPath, "utf8");
  const turnstileSource = fs.readFileSync(turnstilePath, "utf8");

  const errors: string[] = [];

  assertIncludes(middlewareSource, /Content-Security-Policy/, "middleware.ts must set Content-Security-Policy", errors);
  assertIncludes(middlewareSource, /x-nonce/, "middleware.ts must forward a nonce header", errors);
  assertIncludes(middlewareSource, /CSRF_COOKIE_NAME/, "middleware.ts must issue the CSRF cookie", errors);
  assertIncludes(layoutSource, /headers\(\)/, "src/app/layout.tsx must read the CSP nonce from request headers", errors);
  assertIncludes(layoutSource, /SecurityRuntimeProvider/, "src/app/layout.tsx must wrap the app in SecurityRuntimeProvider", errors);
  assertIncludes(layoutSource, /nonce=\{nonce\}/, "src/app/layout.tsx must nonce the inline theme script", errors);
  assertIncludes(providerSource, /CSRF_HEADER_NAME/, "SecurityRuntimeProvider must attach the CSRF header", errors);
  assertIncludes(providerSource, /window\.fetch = async/, "SecurityRuntimeProvider must patch same-origin browser fetch calls", errors);
  assertIncludes(turnstileSource, /nonce=\{nonce \?\? undefined\}/, "TurnstileWidget must pass the CSP nonce to next/script", errors);

  if (errors.length > 0) {
    console.error("[csp-contract] failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("[csp-contract] ok");
}

main();
