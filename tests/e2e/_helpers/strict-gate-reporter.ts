import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

export default class StrictGateReporter implements Reporter {
  private testCount = 0;
  private readonly finalStatuses = new Map<string, TestResult["status"]>();
  private readonly titles = new Map<string, string>();

  onBegin(_config: FullConfig, suite: Suite) {
    this.testCount = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.finalStatuses.set(test.id, result.status);
    this.titles.set(test.id, test.titlePath().join(" > "));
  }

  async onEnd(_result: FullResult): Promise<{ status: "failed" } | void> {
    if (process.env.E2E_SCOPE !== "critical") return;

    const skipped = Array.from(this.finalStatuses.entries())
      .filter(([, status]) => status === "skipped")
      .map(([id]) => this.titles.get(id) ?? id);
    if (this.testCount === 0 || skipped.length > 0) {
      if (this.testCount === 0) {
        console.error("[e2e] Critical gate selected zero tests.");
      }
      for (const title of skipped) {
        console.error(`[e2e] Critical test was skipped: ${title}`);
      }
      return { status: "failed" };
    }
  }
}
