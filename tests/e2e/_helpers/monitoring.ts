import { expect, type ConsoleMessage, type Page, type Response } from "@playwright/test";

type MonitoringOptions = {
  allowedHttpStatuses?: number[];
  allowedHttpUrlPatterns?: RegExp[];
  allowedConsolePatterns?: RegExp[];
  allowedPageErrorPatterns?: RegExp[];
  monitorConsoleTypes?: string[];
};

type MonitoringIssue = {
  kind: "pageerror" | "console" | "http";
  message: string;
};

const DEFAULT_ALLOWED_CONSOLE_PATTERNS = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  /NO_COLOR/i,
  /Failed to load resource: the server responded with a status of (400|401|403|404)/i,
  /Error initializing chat: TypeError: Failed to fetch/i,
  /Error initializing chat: TypeError: network error/i,
];

const DEFAULT_ALLOWED_PAGE_ERROR_PATTERNS = [
  /No QueryClient set, use QueryClientProvider/i,
  /Switched to client rendering because the server rendering errored/i,
];

export function attachPageMonitoring(page: Page, options?: MonitoringOptions) {
  const issues: MonitoringIssue[] = [];
  const allowedStatuses = new Set(options?.allowedHttpStatuses ?? [400, 401, 403, 404, 409, 422]);
  const allowedHttpUrlPatterns = options?.allowedHttpUrlPatterns ?? [];
  const allowedConsolePatterns = [
    ...DEFAULT_ALLOWED_CONSOLE_PATTERNS,
    ...(options?.allowedConsolePatterns ?? []),
  ];
  const monitoredConsoleTypes = new Set(options?.monitorConsoleTypes ?? ["error"]);
  const allowedPageErrorPatterns = [
    ...DEFAULT_ALLOWED_PAGE_ERROR_PATTERNS,
    ...(options?.allowedPageErrorPatterns ?? []),
  ];

  const onPageError = (error: Error) => {
    const message = error.message || String(error);
    if (allowedPageErrorPatterns.some((pattern) => pattern.test(message))) return;
    issues.push({ kind: "pageerror", message });
  };

  const onConsole = (message: ConsoleMessage) => {
    if (!monitoredConsoleTypes.has(message.type())) return;
    const text = message.text();
    if (allowedConsolePatterns.some((pattern) => pattern.test(text))) return;
    issues.push({ kind: "console", message: text });
  };

  const onResponse = (response: Response) => {
    const status = response.status();
    if (status < 500) return;
    const url = response.url();
    if (allowedStatuses.has(status)) return;
    if (allowedHttpUrlPatterns.some((pattern) => pattern.test(url))) return;
    issues.push({ kind: "http", message: `${status} ${url}` });
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("response", onResponse);

  const detach = () => {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  };

  const assertNoViolations = async () => {
    if (issues.length === 0) return;
    const details = issues.map((issue) => `${issue.kind}: ${issue.message}`).join("\n");
    await expect
      .soft(issues, `Unexpected runtime/network issues detected:\n${details}`)
      .toHaveLength(0);
  };

  return {
    detach,
    assertNoViolations,
  };
}
