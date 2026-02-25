"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { getRunnerPref, setRunnerPref } from "@/lib/runner/prefs";
import { getExecutionBackendStatus, testExecutionBackend } from "@/app/actions/execute";
import { preloadPyodide } from "@/lib/runner/pyodide";
import { Check, Loader2, X } from "lucide-react";

const RUNNABLE_LANGUAGES = [
  { name: "Python", ext: ".py", type: "client" as const },
  { name: "JavaScript", ext: ".js, .mjs", type: "client" as const },
  { name: "SQL", ext: ".sql", type: "client" as const },
  { name: "TypeScript", ext: ".ts, .tsx", type: "client" as const, optIn: "runner.typescript.enabled" },
  { name: "Java", ext: ".java", type: "server" as const },
  { name: "C", ext: ".c", type: "server" as const },
  { name: "C++", ext: ".cpp, .cc", type: "server" as const },
];

export default function LanguagesSettings() {
  const [mounted, setMounted] = useState(false);
  const [typescriptEnabled, setTypescriptEnabled] = useState(false);
  const [backendConfigured, setBackendConfigured] = useState(false);
  const [pythonPreloading, setPythonPreloading] = useState(false);
  const [pythonPreloaded, setPythonPreloaded] = useState(false);
  const [backendTesting, setBackendTesting] = useState(false);
  const [backendTestResult, setBackendTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setTypescriptEnabled(getRunnerPref("runner.typescript.enabled") === "true");
  }, [mounted]);

  useEffect(() => {
    getExecutionBackendStatus().then((s) => setBackendConfigured(s.configured));
  }, []);

  const handleTypeScriptToggle = () => {
    const next = !typescriptEnabled;
    setRunnerPref("runner.typescript.enabled", next ? "true" : "false");
    setTypescriptEnabled(next);
  };

  const handlePreloadPython = async () => {
    setPythonPreloading(true);
    try {
      await preloadPyodide();
      setPythonPreloaded(true);
    } catch {
      setPythonPreloaded(false);
    } finally {
      setPythonPreloading(false);
    }
  };

  const handleTestBackend = async () => {
    setBackendTesting(true);
    setBackendTestResult(null);
    try {
      const result = await testExecutionBackend();
      setBackendTestResult(result);
    } finally {
      setBackendTesting(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="space-y-10 pb-10">
      <SettingsPageHeader
        title="Languages"
        description="Code execution runtimes and preferences. Client languages run in-browser; server languages require an execution backend."
      />

      <Card id="typescript">
        <CardHeader>
          <CardTitle>TypeScript</CardTitle>
          <CardDescription>
            Enable TypeScript (.ts, .tsx) execution in the Files workspace. Uses Sucrase for transpilation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <div className="font-medium">Enable TypeScript</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                Run .ts and .tsx files in-browser
              </div>
            </div>
            <button
              onClick={handleTypeScriptToggle}
              className={`
                relative w-12 h-6 rounded-full transition-colors
                ${typescriptEnabled ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600"}
              `}
              aria-pressed={typescriptEnabled}
            >
              <span
                className={`
                  absolute top-1 w-4 h-4 rounded-full bg-white transition-transform
                  ${typescriptEnabled ? "left-7" : "left-1"}
                `}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      <Card id="backend">
        <CardHeader>
          <CardTitle>Execution Backend</CardTitle>
          <CardDescription>
            Java, C, and C++ require a Piston-compatible execution backend. Configure EXECUTION_BACKEND_URL in your environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 p-4 border rounded-lg">
              {backendConfigured ? (
                <>
                  <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="font-medium text-green-700 dark:text-green-300">Backend configured</span>
                </>
              ) : (
                <>
                  <X className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-medium text-amber-700 dark:text-amber-300">Backend not configured</span>
                  <span className="text-sm text-zinc-500">Set EXECUTION_BACKEND_URL for Java, C, C++</span>
                </>
              )}
            </div>
            {backendConfigured && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestBackend}
                disabled={backendTesting}
                className="w-fit"
              >
                {backendTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test connection"
                )}
              </Button>
            )}
            {backendTestResult && (
              <p className="text-sm">
                {backendTestResult.ok ? (
                  <span className="text-green-600 dark:text-green-400">Connection successful</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    Connection failed: {backendTestResult.error}
                  </span>
                )}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supported Languages</CardTitle>
          <CardDescription>Languages available for execution in the Files workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreloadPython}
              disabled={pythonPreloading || pythonPreloaded}
            >
              {pythonPreloading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : pythonPreloaded ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-600" />
                  Python ready
                </>
              ) : (
                "Pre-load Python"
              )}
            </Button>
          </div>
          <ul className="space-y-3">
            {RUNNABLE_LANGUAGES.map((lang) => (
              <li
                key={lang.name}
                className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <div>
                  <div className="font-medium">{lang.name}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{lang.ext}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">
                  {lang.type === "client"
                    ? lang.optIn && lang.name === "TypeScript"
                      ? typescriptEnabled
                        ? "Enabled"
                        : "Opt-in"
                      : "Client"
                    : backendConfigured
                      ? "Server"
                      : "Backend required"}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
