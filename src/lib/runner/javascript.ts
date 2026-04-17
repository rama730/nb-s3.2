import type { ExecutorResult } from "./types";
import { runInBrowserSandbox } from "./browser-sandbox";

export async function runJavaScript(code: string): Promise<ExecutorResult> {
  return runInBrowserSandbox(code);
}
