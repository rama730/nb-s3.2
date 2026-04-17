import type { ExecutorResult } from "./types";
import { runInBrowserSandbox } from "./browser-sandbox";

export async function runTypeScript(code: string, ext: ".ts" | ".tsx"): Promise<ExecutorResult> {
  try {
    const { transform } = await import("sucrase");
    const transforms: Array<"typescript" | "jsx"> = ext === ".tsx" ? ["typescript", "jsx"] : ["typescript"];
    const transformed = transform(code, { transforms });
    return runInBrowserSandbox(transformed.code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: msg,
      exitCode: 1,
    };
  }
}
