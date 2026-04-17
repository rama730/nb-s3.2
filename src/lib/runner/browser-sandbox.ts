import type { ExecutorResult } from "./types";

const SANDBOX_RESULT_EVENT = "nb-runner-result";
const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;

function buildSandboxWorkerSource() {
  return `
    const stdout = [];
    const stderr = [];

    function stringifyValue(value) {
      try {
        if (typeof value === "string") return value;
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === "object" && value !== null) return JSON.stringify(value);
        return String(value);
      } catch {
        return String(value);
      }
    }

    function capture(target) {
      return (...args) => {
        target.push(args.map(stringifyValue).join(" "));
      };
    }

    function deny(name) {
      return () => {
        throw new Error(name + " is unavailable in sandboxed execution");
      };
    }

    function setReadonlyValue(key, value) {
      try {
        Object.defineProperty(self, key, {
          configurable: true,
          enumerable: false,
          writable: true,
          value,
        });
      } catch {
        try {
          self[key] = value;
        } catch {
          // Ignore readonly assignment failures.
        }
      }
    }

    self.addEventListener("message", async (event) => {
      const data = event.data;
      if (!data || data.type !== "execute" || typeof data.code !== "string") {
        return;
      }

      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const originalFetch = typeof self.fetch === "function" ? self.fetch : undefined;
      const originalWebSocket = typeof self.WebSocket === "function" ? self.WebSocket : undefined;
      const originalEventSource = typeof self.EventSource === "function" ? self.EventSource : undefined;

      const finish = (exitCode) => {
        self.postMessage({
          type: "${SANDBOX_RESULT_EVENT}",
          payload: {
            stdout: stdout.join("\\n"),
            stderr: stderr.join("\\n"),
            exitCode,
          },
        });
      };

      console.log = capture(stdout);
      console.warn = capture(stderr);
      console.error = capture(stderr);

      setReadonlyValue("fetch", deny("Network access"));
      setReadonlyValue("WebSocket", deny("WebSocket access"));
      setReadonlyValue("EventSource", deny("EventSource access"));
      setReadonlyValue("XMLHttpRequest", deny("XMLHttpRequest access"));
      setReadonlyValue("importScripts", deny("importScripts"));
      setReadonlyValue("prompt", deny("prompt"));
      setReadonlyValue("alert", deny("alert"));
      setReadonlyValue("confirm", deny("confirm"));

      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const executor = new AsyncFunction('"use strict";\\n' + data.code);
        await executor();
        finish(0);
      } catch (error) {
        stderr.push(stringifyValue(error));
        finish(1);
      } finally {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        if (originalFetch) setReadonlyValue("fetch", originalFetch);
        if (originalWebSocket) setReadonlyValue("WebSocket", originalWebSocket);
        if (originalEventSource) setReadonlyValue("EventSource", originalEventSource);
      }
    });
  `;
}

function buildSandboxFrameSource() {
  const workerSource = JSON.stringify(buildSandboxWorkerSource());

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" />
  </head>
  <body>
    <script>
      const sandboxWorkerSource = ${workerSource};
      let activeWorker = null;

      function cleanupWorker() {
        if (activeWorker) {
          activeWorker.terminate();
          activeWorker = null;
        }
      }

      window.addEventListener("message", (event) => {
        if (event.source !== parent) return;
        const data = event.data;
        if (!data || data.type !== "nb-runner-execute" || typeof data.requestId !== "string") return;

        cleanupWorker();
        const workerUrl = URL.createObjectURL(new Blob([sandboxWorkerSource], { type: "text/javascript" }));
        const worker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);
        activeWorker = worker;

        const forwardFailure = (message) => {
          parent.postMessage({
            type: "${SANDBOX_RESULT_EVENT}",
            requestId: data.requestId,
            payload: {
              stdout: "",
              stderr: message,
              exitCode: 1,
            },
          }, "*");
          cleanupWorker();
        };

        worker.addEventListener("message", (workerEvent) => {
          const payload = workerEvent.data && workerEvent.data.payload ? workerEvent.data.payload : {
            stdout: "",
            stderr: "Sandbox execution failed",
            exitCode: 1,
          };
          parent.postMessage({
            type: "${SANDBOX_RESULT_EVENT}",
            requestId: data.requestId,
            payload,
          }, "*");
          cleanupWorker();
        }, { once: true });

        worker.addEventListener("error", (workerError) => {
          forwardFailure(workerError.message || "Sandbox execution failed");
        }, { once: true });

        worker.postMessage({
          type: "execute",
          code: data.code,
        });
      });
    </script>
  </body>
</html>`;
}

export async function runInBrowserSandbox(
  code: string,
  timeoutMs: number = DEFAULT_SANDBOX_TIMEOUT_MS,
): Promise<ExecutorResult> {
  if (
    typeof window === "undefined"
    || typeof document === "undefined"
    || typeof Blob === "undefined"
    || typeof Worker === "undefined"
  ) {
    return {
      stdout: "",
      stderr: "Sandboxed execution is unavailable in this environment",
      exitCode: 1,
    };
  }

  return new Promise<ExecutorResult>((resolve) => {
    const requestId = `runner-${crypto.randomUUID()}`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.display = "none";
    iframe.srcdoc = buildSandboxFrameSource();

    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
      iframe.remove();
    };

    const finish = (result: ExecutorResult) => {
      cleanup();
      resolve(result);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as
        | {
            type?: string;
            requestId?: string;
            payload?: ExecutorResult;
          }
        | undefined;

      if (!data || data.type !== SANDBOX_RESULT_EVENT || data.requestId !== requestId || !data.payload) {
        return;
      }

      finish(data.payload);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        stdout: "",
        stderr: `Execution timed out after ${Math.floor(timeoutMs / 1000)}s`,
        exitCode: 1,
      });
    }, timeoutMs);

    window.addEventListener("message", handleMessage);

    iframe.addEventListener(
      "load",
      () => {
        iframe.contentWindow?.postMessage(
          {
            type: "nb-runner-execute",
            requestId,
            code,
          },
          "*",
        );
      },
      { once: true },
    );

    document.body.appendChild(iframe);
  });
}
