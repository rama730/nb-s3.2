import type { ExecutorResult } from "./types";

export async function runTypeScript(code: string, ext: ".ts" | ".tsx"): Promise<ExecutorResult> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    stdoutLines.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    stderrLines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderrLines.push(args.map(String).join(" "));
  };

  try {
    const { transform } = await import("sucrase");
    const transforms: Array<"typescript" | "jsx"> = ext === ".tsx" ? ["typescript", "jsx"] : ["typescript"];
    const transformed = transform(code, { transforms });
    const fn = new Function(transformed.code);
    fn();
    return {
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
      exitCode: 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderrLines.push(msg);
    return {
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
      exitCode: 1,
    };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}
