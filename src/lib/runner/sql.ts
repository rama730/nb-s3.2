import type { ExecutorResult } from "./types";

const SQLJS_CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js";
const SQLJS_WASM =
  "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.wasm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlJsPromise: Promise<any> | null = null;

async function getSqlJs() {
  if (sqlJsPromise) return sqlJsPromise;
  if (typeof window === "undefined") throw new Error("sql.js runs only in the browser");

  const win = window as Window & { initSqlJs?: (opts: { locateFile: (f: string) => string }) => Promise<unknown> };
  if (!win.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SQLJS_CDN;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load sql.js"));
      document.head.appendChild(script);
    });
  }
  sqlJsPromise = win.initSqlJs!({
    locateFile: () => SQLJS_WASM,
  });
  return sqlJsPromise;
}

function formatRows(rows: unknown[][]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => r.map(String).join(" | ")).join("\n");
}

export async function runSql(code: string): Promise<ExecutorResult> {
  const outputLines: string[] = [];
  try {
    const SQL = await getSqlJs();
    const db = new SQL.Database();

    const statements = code
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      if (!stmt) continue;
      try {
        if (stmt.toLowerCase().startsWith("select")) {
          const result = db.exec(stmt + ";");
          for (const r of result) {
            const cols = r.columns ?? [];
            outputLines.push(cols.join(" | "));
            outputLines.push(cols.map(() => "---").join(" | "));
            outputLines.push(formatRows(r.values));
          }
        } else {
          db.run(stmt + ";");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          stdout: outputLines.join("\n"),
          stderr: msg,
          exitCode: 1,
        };
      }
    }

    db.close();
    return {
      stdout: outputLines.join("\n"),
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: msg,
      exitCode: 1,
    };
  }
}
