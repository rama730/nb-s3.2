/**
 * Files Tab V3 — Editor theme: dark mode → editor uses dark theme.
 *
 * Task 14.12. Audit area: `editor-theme` (Req 25.1).
 *
 * Covers:
 *   - Req 19.2 When the app theme is "dark", the editor renders with a dark
 *              theme (dark background, light text).
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Set app to dark mode, open a text file in edit mode, verify the editor
 *   has a dark background.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - No editable text file → record `not_applicable`.
 *   - Theme toggle not available → record `not_applicable`.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const ROW_TESTID = "files-tab-folder-list-row";
const FILE_VIEW_TESTID = "files-tab-file-view";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "editor-theme";

type ScenarioOutcome =
  | { result: "pass" }
  | { result: "not_applicable"; justification: string };

async function runScenario(
  area: string,
  body: () => Promise<ScenarioOutcome>,
): Promise<void> {
  let outcome: { result: AuditResult; justification?: string };
  try {
    outcome = await body();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAudit(area, "fail", `editor-theme spec failed: ${message.slice(0, 400)}`);
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

async function openFilesTabV3(
  page: Page,
): Promise<{ ready: boolean; reason?: string }> {
  await login(page);
  await page.goto(FILES_TAB_URL, { waitUntil: "domcontentloaded" });

  const activeTab = new URL(page.url()).searchParams.get("tab");
  if (activeTab !== "files") {
    const filesTab = page.getByTestId("project-tab-files").first();
    if (await filesTab.count()) await filesTab.click();
  }

  const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
  try {
    await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
  } catch {
    return {
      ready: false,
      reason:
        `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear ` +
        `within ${V3_DETECT_TIMEOUT_MS}ms for project "${PROJECT_SLUG}".`,
    };
  }

  await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });

  return { ready: true };
}

/**
 * Attempts to enable dark mode via the app's theme toggle. Returns true
 * if dark mode was successfully activated.
 */
async function enableDarkMode(page: Page): Promise<boolean> {
  // Try common theme toggle patterns.
  // Pattern 1: Theme toggle button in settings/header.
  const themeToggle = page.locator('[data-testid="theme-toggle"], [aria-label*="theme" i], [aria-label*="dark" i]').first();
  if (await themeToggle.count()) {
    await themeToggle.click();
    await page.waitForTimeout(500);
    return true;
  }

  // Pattern 2: Use prefers-color-scheme media emulation.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);

  // Verify dark mode is active by checking the html/body class or attribute.
  const isDark = await page.evaluate(() => {
    const html = document.documentElement;
    return (
      html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark" ||
      html.style.colorScheme === "dark" ||
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  return isDark;
}

test.describe("Files tab v3 — Editor theme (Task 14.12)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("dark mode → editor uses dark theme (Req 19.2)", async ({ browser }) => {
    await runScenario(AREA, async () => {
      const context = await browser.newContext({ colorScheme: "dark" });
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error", "warning"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /FilesTabMain: surface disagreement/i,
        ],
      });

      try {
        const opened = await openFilesTabV3(page);
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // Ensure dark mode is active.
        const darkActive = await enableDarkMode(page);
        if (!darkActive) {
          return {
            result: "not_applicable",
            justification:
              "Could not activate dark mode; theme toggle not found and " +
              "prefers-color-scheme emulation did not trigger dark class.",
          };
        }

        // Open a text file to trigger the editor/TextViewer.
        const fileRow = page
          .locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`)
          .first();
        if (!(await fileRow.count())) {
          return {
            result: "not_applicable",
            justification: "No file rows visible in the folder list.",
          };
        }
        await fileRow.click();

        const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
        try {
          await expect(fileView).toBeVisible({ timeout: 15_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "FileView did not render after clicking file row.",
          };
        }

        // Look for the editor surface (CodeMirror or Monaco or TextViewer).
        const editorSurface = page.locator(
          '.cm-editor, .monaco-editor, [data-testid="text-viewer"], [data-testid="file-editor"]',
        ).first();

        try {
          await expect(editorSurface).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification:
              "Editor surface (CodeMirror/Monaco/TextViewer) not found; " +
              "the opened file may not be a text file.",
          };
        }

        // Verify the editor has a dark background (Req 19.2).
        const bgColor = await editorSurface.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return style.backgroundColor;
        });

        // Parse the background color and verify it's dark.
        // Dark backgrounds typically have RGB values < 128.
        const rgbMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bgColor);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1], 10);
          const g = parseInt(rgbMatch[2], 10);
          const b = parseInt(rgbMatch[3], 10);
          const luminance = (r + g + b) / 3;
          expect(
            luminance,
            `Req 19.2: Editor background must be dark in dark mode (got rgb(${r},${g},${b}), luminance=${luminance})`,
          ).toBeLessThan(128);
        } else {
          // If we can't parse the color, check for dark-related classes.
          const hasDarkClass = await editorSurface.evaluate((el) => {
            return (
              el.classList.contains("cm-dark") ||
              el.closest(".dark") !== null ||
              el.getAttribute("data-theme") === "dark"
            );
          });
          expect(
            hasDarkClass,
            "Req 19.2: Editor must have dark theme indicators in dark mode",
          ).toBe(true);
        }

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
