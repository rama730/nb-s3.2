"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Github,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  ExternalLink,
  GitBranch,
  RefreshCw,
  Search,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import { useToast } from "@/components/ui-custom/Toast";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import {
  fetchSecurityStepUpCapabilities,
  useEnableEmailSignIn,
  useExtensionSessionsData,
  useIntegrationsData,
} from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getPasswordPolicyResult,
  PASSWORD_MIN_LENGTH,
} from "@/lib/security/password-policy";
import type {
  AuthConnectionMethod,
  ConnectedProject,
  ExtensionSessionData,
  IntegrationsAuthProvider,
  IntegrationsAuthProviderState,
  ServiceIntegrationConnection,
} from "@/lib/types/settingsTypes";
import {
  getActiveExtensionSessions,
  revokeExtensionSession,
  generateExtensionAuthCode,
  generateExtensionToken,
} from "@/app/actions/extension-sessions";
import { retryGithubImportAction, getSyncPreviewAction } from "@/app/actions/project";

type SecurityStepUpMethod = "totp" | "recovery_code";
type ExtensionSession = ExtensionSessionData;

type ExtensionSessionPresentation = {
  title: string;
  authLabel: string;
  deviceLabel: string;
  platformLabel: string | null;
  versionLabel: string;
  editorVersionLabel: string | null;
  lastActiveLabel: string | null;
  expiresLabel: string | null;
};

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.69-.06-1.2-.19-1.73H12v3.27h5.52c-.11.81-.72 2.04-2.08 2.86l-.02.11 3.02 2.29.21.02c1.93-1.75 3.05-4.33 3.05-7.82Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.87 6.61-2.36l-3.21-2.42c-.86.58-2.01.99-3.4.99-2.64 0-4.88-1.75-5.68-4.18l-.1.01-3.14 2.38-.03.1A9.98 9.98 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.32 14.03A5.98 5.98 0 0 1 6 12c0-.7.12-1.37.31-2.03l-.01-.14-3.18-2.42-.1.05A9.9 9.9 0 0 0 2 12c0 1.6.38 3.1 1.03 4.45l3.29-2.42Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.79c1.76 0 2.94.74 3.61 1.36l2.64-2.53C16.95 3.42 14.7 2 12 2a9.98 9.98 0 0 0-8.95 5.49l3.29 2.51C7.13 7.54 9.36 5.79 12 5.79Z"
      />
    </svg>
  );
}

function ProviderIcon({
  provider,
  className,
}: {
  provider: IntegrationsAuthProvider;
  className?: string;
}) {
  if (provider === "google") {
    return <GoogleIcon className={className} />;
  }

  if (provider === "github") {
    return <Github className={className} />;
  }

  return <Mail className={className} />;
}

const PROVIDER_GLYPH_STYLES: Record<IntegrationsAuthProvider, string> = {
  google: "bg-white dark:bg-zinc-950",
  github: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  email: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

const STATE_BADGE_COPY: Record<IntegrationsAuthProviderState, string> = {
  primary: "Primary",
  linked: "Linked",
  not_linked: "Not linked",
};

const STATE_BADGE_STYLES: Record<IntegrationsAuthProviderState, string> = {
  primary:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  linked:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  not_linked: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const SERVICE_BADGE_STYLES: Record<
  ServiceIntegrationConnection["status"],
  string
> = {
  connected:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  available: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  not_connected:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const SERVICE_BADGE_COPY: Record<
  ServiceIntegrationConnection["status"],
  string
> = {
  connected: "Connected",
  available: "Available",
  not_connected: "Not connected",
};

function ProviderGlyph({ provider }: { provider: IntegrationsAuthProvider }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/70 dark:border-zinc-800",
        PROVIDER_GLYPH_STYLES[provider],
      )}
    >
      <ProviderIcon provider={provider} className="h-5 w-5" />
    </div>
  );
}

function formatRelativeTimestamp(
  value: string | Date | null | undefined,
): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

function parseProtocol(callbackUrl: string | null): string | null {
  if (!callbackUrl) return null;
  try {
    return new URL(callbackUrl).protocol.replace(":", "").toLowerCase();
  } catch {
    const match = callbackUrl.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    return match && match[1] ? match[1].toLowerCase() : null;
  }
}

function getCallbackEditorName(callbackUrl: string | null): string {
  const protocol = parseProtocol(callbackUrl);
  if (!protocol) return "Editor extension";
  const normalizedCallback = callbackUrl?.toLowerCase() ?? "";

  if (protocol === "cursor") return "Cursor";
  if (protocol === "windsurf") return "Windsurf";
  if (protocol === "antigravity" || protocol === "google-antigravity")
    return "Antigravity IDE";
  if (protocol === "jetbrains") {
    if (/\bwebstorm\b/.test(normalizedCallback)) return "WebStorm";
    if (/\bpycharm\b/.test(normalizedCallback)) return "PyCharm";
    if (/\bphpstorm\b/.test(normalizedCallback)) return "PhpStorm";
    if (/\bclion\b/.test(normalizedCallback)) return "CLion";
    if (/\bgo\s?land\b/.test(normalizedCallback)) return "GoLand";
    if (/\brider\b/.test(normalizedCallback)) return "Rider";
    if (/\bruby\s?mine\b/.test(normalizedCallback)) return "RubyMine";
    if (/\bdata\s?grip\b/.test(normalizedCallback)) return "DataGrip";
    if (/\bdata\s?spell\b/.test(normalizedCallback)) return "DataSpell";
    if (/\bfleet\b/.test(normalizedCallback)) return "Fleet";
    if (/\brust\s?rover\b/.test(normalizedCallback)) return "RustRover";
    if (/\baqua\b/.test(normalizedCallback)) return "Aqua";
    if (/\b(intellij\s+idea|intellij|idea)\b/.test(normalizedCallback))
      return "IntelliJ IDEA";
    return "JetBrains IDE";
  }
  if (protocol === "intellij" || protocol === "intellij-idea" || protocol === "idea")
    return "IntelliJ IDEA";
  if (protocol === "webstorm") return "WebStorm";
  if (protocol === "pycharm") return "PyCharm";
  if (protocol === "phpstorm") return "PhpStorm";
  if (protocol === "clion") return "CLion";
  if (protocol === "goland") return "GoLand";
  if (protocol === "rider") return "Rider";
  if (protocol === "rubymine") return "RubyMine";
  if (protocol === "datagrip") return "DataGrip";
  if (protocol === "dataspell") return "DataSpell";
  if (protocol === "fleet") return "Fleet";
  if (protocol === "rustrover") return "RustRover";
  if (protocol === "aqua") return "Aqua";
  if (protocol === "qtcreator" || protocol === "qt-creator")
    return "Qt Creator";
  if (protocol === "kiro") return "Kiro";
  if (protocol === "zed") return "Zed";
  if (protocol === "vscodium" || protocol === "codium") return "VSCodium";
  if (protocol === "trae") return "Trae";
  if (protocol === "void") return "Void";
  if (protocol === "gemini") return "Gemini";
  if (protocol === "vscode-insiders") return "VS Code Insiders";
  if (protocol === "vscode") return "VS Code";
  if (protocol === "http") return "Local editor bridge";

  return protocol
    .split(/[-_]+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "ide") return "IDE";
      if (lower === "vs") return "VS";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function IconAsset({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("block bg-contain bg-center bg-no-repeat", className)}
      style={{ backgroundImage: `url('${src}')` }}
    />
  );
}

function ExtensionAppIcon({ className }: { className?: string }) {
  return <IconAsset src="/icon-192.png" className={className} />;
}

function GoogleEditorIcon({ className }: { className?: string }) {
  return <GoogleIcon className={className} />;
}

type EditorBrand =
  | "antigravity"
  | "antigravity-ide"
  | "aqua"
  | "clion"
  | "cursor"
  | "datagrip"
  | "dataspell"
  | "fleet"
  | "gemini"
  | "goland"
  | "google"
  | "intellij-idea"
  | "kiro"
  | "phpstorm"
  | "pycharm"
  | "qt-creator"
  | "rider"
  | "rubymine"
  | "rustrover"
  | "trae"
  | "void"
  | "vscode"
  | "vscode-insiders"
  | "vscodium"
  | "webstorm"
  | "windsurf"
  | "zed"
  | "extension";

type EditorTheme = {
  brand: EditorBrand;
  label: string;
  icon: (props: { className?: string }) => React.JSX.Element;
  iconClassName: string;
  containerClass: string;
};

const IDE_ICON_ASSETS: Partial<Record<EditorBrand, string>> = {
  "antigravity-ide": "/ide-icons/antigravity-ide.png",
  antigravity: "/ide-icons/antigravity.png",
  aqua: "/ide-icons/aqua.svg",
  clion: "/ide-icons/clion.svg",
  cursor: "/ide-icons/cursor.png",
  datagrip: "/ide-icons/datagrip.svg",
  dataspell: "/ide-icons/dataspell.svg",
  fleet: "/ide-icons/fleet.svg",
  goland: "/ide-icons/goland.svg",
  "intellij-idea": "/ide-icons/intellij-idea.svg",
  kiro: "/ide-icons/kiro.png",
  phpstorm: "/ide-icons/phpstorm.svg",
  pycharm: "/ide-icons/pycharm.svg",
  "qt-creator": "/ide-icons/qt-creator.png",
  rider: "/ide-icons/rider.svg",
  rubymine: "/ide-icons/rubymine.svg",
  rustrover: "/ide-icons/rustrover.svg",
  trae: "/ide-icons/trae.png",
  void: "/ide-icons/void.png",
  vscode: "/ide-icons/vscode.png",
  "vscode-insiders": "/ide-icons/vscode.png",
  vscodium: "/ide-icons/vscodium.png",
  webstorm: "/ide-icons/webstorm.svg",
  windsurf: "/ide-icons/windsurf.svg",
  zed: "/ide-icons/zed.png",
};

const EDITOR_BRAND_LABELS: Record<EditorBrand, string> = {
  antigravity: "Antigravity IDE",
  "antigravity-ide": "Antigravity IDE",
  aqua: "Aqua",
  clion: "CLion",
  cursor: "Cursor",
  datagrip: "DataGrip",
  dataspell: "DataSpell",
  fleet: "Fleet",
  gemini: "Gemini",
  goland: "GoLand",
  google: "Google",
  "intellij-idea": "IntelliJ IDEA",
  kiro: "Kiro",
  phpstorm: "PhpStorm",
  pycharm: "PyCharm",
  "qt-creator": "Qt Creator",
  rider: "Rider",
  rubymine: "RubyMine",
  rustrover: "RustRover",
  trae: "Trae",
  void: "Void",
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  vscodium: "VSCodium",
  webstorm: "WebStorm",
  windsurf: "Windsurf",
  zed: "Zed",
  extension: "Editor extension",
};

function resolveEditorBrand(values: Array<string | null | undefined>): EditorBrand {
  const normalized = values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (!normalized) return "extension";
  if (/\banti[-\s]?gravity\s+ide\b/.test(normalized)) return "antigravity-ide";
  if (/\banti[-\s]?gravity\b/.test(normalized) || normalized.includes("google antigravity"))
    return "antigravity-ide";
  if (/\b(intellij\s+idea|intellij|idea)\b/.test(normalized))
    return "intellij-idea";
  if (/\bwebstorm\b/.test(normalized)) return "webstorm";
  if (/\bpycharm\b/.test(normalized)) return "pycharm";
  if (/\bphpstorm\b/.test(normalized)) return "phpstorm";
  if (/\bclion\b/.test(normalized)) return "clion";
  if (/\bgo\s?land\b/.test(normalized)) return "goland";
  if (/\brider\b/.test(normalized)) return "rider";
  if (/\bruby\s?mine\b/.test(normalized)) return "rubymine";
  if (/\bdata\s?grip\b/.test(normalized)) return "datagrip";
  if (/\bdata\s?spell\b/.test(normalized)) return "dataspell";
  if (/\bfleet\b/.test(normalized)) return "fleet";
  if (/\brust\s?rover\b/.test(normalized)) return "rustrover";
  if (/\baqua\b/.test(normalized)) return "aqua";
  if (/\bqt[-\s]?creator\b/.test(normalized) || /\bqtcreator\b/.test(normalized))
    return "qt-creator";
  if (/\bcursor\b/.test(normalized)) return "cursor";
  if (/\bkiro\b/.test(normalized)) return "kiro";
  if (/\btrae\b/.test(normalized)) return "trae";
  if (/\bvoid\b/.test(normalized)) return "void";
  if (/\b(vscodium|codium)\b/.test(normalized)) return "vscodium";
  if (/\bwindsurf\b/.test(normalized)) return "windsurf";
  if (/\bzed\b/.test(normalized)) return "zed";
  if (/\bvscode[-\s]?insiders\b/.test(normalized) || normalized.includes("code - insiders"))
    return "vscode-insiders";
  if (
    /\b(vs\s*code|vscode|visual studio code)\b/.test(normalized) ||
    normalized === "code"
  ) {
    return "vscode";
  }
  if (/\bgemini\b/.test(normalized)) return "gemini";
  if (/\bgoogle\b/.test(normalized)) return "google";
  return "extension";
}

function getEditorTheme(brand: EditorBrand): EditorTheme {
  const iconAsset = IDE_ICON_ASSETS[brand];
  if (iconAsset) {
    return {
      brand,
      label: EDITOR_BRAND_LABELS[brand],
      icon: ({ className }) => <IconAsset src={iconAsset} className={className} />,
      iconClassName: "h-8 w-8",
      containerClass: "bg-transparent",
    };
  }

  if (brand === "google" || brand === "gemini") {
    return {
      brand,
      label: EDITOR_BRAND_LABELS[brand],
      icon: GoogleEditorIcon,
      iconClassName: "h-5 w-5",
      containerClass: "bg-white dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800",
    };
  }

  return {
    brand: "extension",
    label: EDITOR_BRAND_LABELS.extension,
    icon: ExtensionAppIcon,
    iconClassName: "h-7 w-7",
    containerClass: "bg-zinc-950 border border-zinc-800 shadow-sm dark:bg-zinc-950",
  };
}

function getCallbackEditorTheme(callbackUrl: string | null): EditorTheme {
  const editorName = getCallbackEditorName(callbackUrl);
  const protocol = parseProtocol(callbackUrl);
  return getEditorTheme(resolveEditorBrand([editorName, protocol, callbackUrl]));
}

function getSessionEditorTheme(session: ExtensionSession): EditorTheme {
  return getEditorTheme(
    resolveEditorBrand([
      session.editorName,
      session.editorHost,
      session.deviceName,
      session.userAgent,
    ]),
  );
}

function getPlatformLabel(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.toLowerCase() ?? "";
  if (!ua) return null;
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os") || ua.includes("macintosh") || ua.includes("macos"))
    return "macOS";
  if (ua.includes("linux") && !ua.includes("android")) return "Linux";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad"))
    return ua.includes("ipad") ? "iPadOS" : "iOS";
  return null;
}

function getEditorPlatformLabel(
  editorPlatform: string | null | undefined,
  userAgent: string | null | undefined,
): string | null {
  const rawPlatform = editorPlatform?.trim();
  const platform = rawPlatform?.toLowerCase();
  if (rawPlatform && platform) {
    if (platform === "darwin" || platform === "mac" || platform === "macos")
      return "macOS";
    if (platform === "win32" || platform === "windows" || platform === "win")
      return "Windows";
    if (platform === "linux") return "Linux";
    if (platform === "freebsd") return "FreeBSD";
    if (platform === "openbsd") return "OpenBSD";
    return rawPlatform.slice(0, 40);
  }

  return getPlatformLabel(userAgent);
}

function getEditorNameLabel(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (/\banti[-\s]?gravity\b/.test(normalized)) return "Antigravity IDE";
  if (/\b(intellij\s+idea|intellij|idea)\b/.test(normalized))
    return "IntelliJ IDEA";
  if (/\bwebstorm\b/.test(normalized)) return "WebStorm";
  if (/\bpycharm\b/.test(normalized)) return "PyCharm";
  if (/\bphpstorm\b/.test(normalized)) return "PhpStorm";
  if (/\bclion\b/.test(normalized)) return "CLion";
  if (/\bgo\s?land\b/.test(normalized)) return "GoLand";
  if (/\brider\b/.test(normalized)) return "Rider";
  if (/\bruby\s?mine\b/.test(normalized)) return "RubyMine";
  if (/\bdata\s?grip\b/.test(normalized)) return "DataGrip";
  if (/\bdata\s?spell\b/.test(normalized)) return "DataSpell";
  if (/\bfleet\b/.test(normalized)) return "Fleet";
  if (/\brust\s?rover\b/.test(normalized)) return "RustRover";
  if (/\baqua\b/.test(normalized)) return "Aqua";
  if (/\bqt[-\s]?creator\b/.test(normalized) || /\bqtcreator\b/.test(normalized))
    return "Qt Creator";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("kiro")) return "Kiro";
  if (normalized.includes("trae")) return "Trae";
  if (/\bvoid\b/.test(normalized)) return "Void";
  if (normalized.includes("vscodium") || normalized.includes("codium"))
    return "VSCodium";
  if (/\bzed\b/.test(normalized)) return "Zed";
  if (normalized.includes("gemini")) return "Gemini";
  if (normalized.includes("google")) return "Google";
  if (normalized.includes("windsurf")) return "Windsurf";
  if (normalized.includes("insiders")) return "VS Code Insiders";
  if (
    normalized.includes("visual studio code") ||
    normalized === "code" ||
    normalized === "vs code"
  ) {
    return "VS Code";
  }
  return raw.slice(0, 80);
}

function getCleanDeviceLabel(session: ExtensionSession): string {
  const editorName = getEditorNameLabel(session.editorName);
  if (editorName) return editorName;

  const raw = session.deviceName?.trim() || "Editor extension";
  return (
    raw
      .replace(/\s*\((browser flow|copy-paste|manual token)\)\s*/gi, "")
      .replace(/^manual token$/i, "Manual editor token")
      .trim() || "Editor extension"
  );
}

function getSessionAuthLabel(session: ExtensionSession): string {
  if (
    session.authMethod === "web_login" ||
    /\bbrowser flow\b/i.test(session.deviceName)
  ) {
    return "Web sign-in";
  }
  return "Manual token";
}

function getScopesLabel(scopes: unknown): string {
  if (!Array.isArray(scopes) || scopes.length === 0)
    return "Default editor access";
  const labels = scopes
    .filter(
      (scope): scope is string =>
        typeof scope === "string" && scope.trim().length > 0,
    )
    .map((scope) => scope.replace(/[_:]/g, " "));
  return labels.length > 0 ? labels.join(", ") : "Default editor access";
}

function getSessionPresentation(
  session: ExtensionSession,
): ExtensionSessionPresentation {
  const deviceLabel = getCleanDeviceLabel(session);
  const platformLabel = getEditorPlatformLabel(
    session.editorPlatform,
    session.userAgent,
  );
  const authLabel = getSessionAuthLabel(session);
  const recognizedEditor =
    /^(vs code|vs code insiders|vscodium|cursor|windsurf|antigravity ide|intellij idea|webstorm|pycharm|phpstorm|clion|goland|rider|rubymine|datagrip|dataspell|fleet|rustrover|aqua|qt creator|kiro|zed|trae|void|gemini|google|editor extension|local editor bridge)$/i.test(
      deviceLabel,
    );
  const title =
    platformLabel && recognizedEditor
      ? `${deviceLabel} on ${platformLabel}`
      : deviceLabel;
  const version = session.clientVersion?.trim();
  const editorVersion = session.editorVersion?.trim();

  return {
    title,
    authLabel,
    deviceLabel,
    platformLabel,
    versionLabel:
      version && version !== "pending"
        ? `NB Extension v${version}`
        : "Version pending",
    editorVersionLabel: editorVersion
      ? `${deviceLabel} ${editorVersion}`
      : null,
    lastActiveLabel: formatRelativeTimestamp(session.lastSeenAt),
    expiresLabel: formatRelativeTimestamp(session.expiresAt),
  };
}

function ExtensionSessionRow({
  session,
  expanded,
  revoking,
  onToggleAdvanced,
  onCopyDiagnostics,
  onRevoke,
}: {
  session: ExtensionSession;
  expanded: boolean;
  revoking: boolean;
  onToggleAdvanced: () => void;
  onCopyDiagnostics: () => void;
  onRevoke: () => void;
}) {
  const presentation = getSessionPresentation(session);
  const theme = getSessionEditorTheme(session);
  const IconComponent = theme.icon;

  return (
    <div className="px-4 py-4 transition hover:bg-zinc-50/70 dark:hover:bg-zinc-950/20 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", theme.containerClass)}>
            <IconComponent className={theme.iconClassName} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {presentation.title}
              </div>
              <Badge className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {presentation.authLabel}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{presentation.versionLabel}</span>
              {presentation.lastActiveLabel ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Last active {presentation.lastActiveLabel}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleAdvanced}
            className="h-8 rounded-lg"
          >
            {expanded ? (
              <>
                Hide details
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Details
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={revoking}
            onClick={onRevoke}
            className="h-8 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {revoking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Revoke
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-400">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="font-medium text-zinc-700 dark:text-zinc-200">
                Editor
              </div>
              <div className="mt-1">
                {presentation.editorVersionLabel ?? presentation.deviceLabel}
              </div>
            </div>
            <div>
              <div className="font-medium text-zinc-700 dark:text-zinc-200">
                Operating system
              </div>
              <div className="mt-1">
                {presentation.platformLabel ?? "Waiting for editor heartbeat"}
              </div>
            </div>
            <div>
              <div className="font-medium text-zinc-700 dark:text-zinc-200">
                Sign-in method
              </div>
              <div className="mt-1">{presentation.authLabel}</div>
            </div>
            <div>
              <div className="font-medium text-zinc-700 dark:text-zinc-200">
                Expires
              </div>
              <div className="mt-1">
                {presentation.expiresLabel ?? "Unknown"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCopyDiagnostics}
              className="h-8 rounded-lg"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy diagnostics
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProviderRow({
  provider,
  onEnableEmailSignIn,
  enablingEmailSignIn,
  onLinkProvider,
  isLinkingProvider,
}: {
  provider: AuthConnectionMethod;
  onEnableEmailSignIn?: () => void;
  enablingEmailSignIn?: boolean;
  onLinkProvider?: () => void;
  isLinkingProvider?: boolean;
}) {
  const lastUsed = formatRelativeTimestamp(provider.lastUsedAt);
  const showVerificationBadge =
    provider.provider === "email" && provider.verificationState;

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex min-w-0 items-start gap-3">
        <ProviderGlyph provider={provider.provider} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {provider.label}
            </div>
            {showVerificationBadge ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  provider.verificationState === "verified"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                )}
              >
                {provider.verificationState === "verified" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Info className="h-3 w-3" />
                )}
                {provider.verificationState === "verified"
                  ? "Email verified"
                  : "Email not verified"}
              </span>
            ) : null}
            {lastUsed ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Last used {lastUsed}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {provider.detail}
          </div>
          {provider.secondaryDetail ? (
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {provider.secondaryDetail}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <Badge
          className={cn(
            "rounded-full px-3 py-1 font-medium",
            STATE_BADGE_STYLES[provider.state],
          )}
        >
          {STATE_BADGE_COPY[provider.state]}
        </Badge>
        {onEnableEmailSignIn ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onEnableEmailSignIn}
            disabled={enablingEmailSignIn}
          >
            {enablingEmailSignIn ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening...
              </>
            ) : (
              "Set a password"
            )}
          </Button>
        ) : null}
        {onLinkProvider ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onLinkProvider}
            disabled={isLinkingProvider}
          >
            {isLinkingProvider ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Linking...
              </>
            ) : (
              "Link"
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function parseRepoName(url: string): string {
  if (!url) return "";
  try {
    const cleanUrl = url.replace(/\/$/, "");
    const parts = cleanUrl.split("/");
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  } catch {}
  return url;
}
function ProjectRow({
  project,
  onSync,
}: {
  project: ConnectedProject;
  onSync: (
    projectId: string,
    resolutions?: Record<string, "keep_local" | "overwrite_github"> | null,
  ) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(
    project.syncStatus === "pending" ||
      project.syncStatus === "cloning" ||
      project.syncStatus === "indexing",
  );
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [resolutions, setResolutions] = useState<Record<string, "keep_local" | "overwrite_github">>({});
  const [searchQuery, setSearchQuery] = useState("");

  const { showToast } = useToast();
  const lastSync = project.lastSyncAt
    ? formatDistanceToNow(new Date(project.lastSyncAt), { addSuffix: true })
    : null;

  const isSyncing = project.syncStatus === "pending" || project.syncStatus === "cloning" || project.syncStatus === "indexing";

  useEffect(() => {
    setSyncing(isSyncing);
  }, [isSyncing]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isSyncing) {
      intervalId = setInterval(() => {
        void queryClient.refetchQueries({
          queryKey: queryKeys.settings.integrations(),
        });
      }, 3000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isSyncing, queryClient]);

  const handleSyncClick = async () => {
    if (syncing || fetchingPreview) return;
    setFetchingPreview(true);
    try {
      const preview = await getSyncPreviewAction(project.id);
      if (!preview.success) {
        showToast(preview.error || "Failed to fetch sync preview", "error");
        setFetchingPreview(false);
        return;
      }

      setPreviewData(preview);

      // Initialize default resolutions (Keep Local by default for conflict protection)
      const initialResolutions: Record<string, "keep_local" | "overwrite_github"> = {};
      if (preview.conflicts) {
        for (const conflict of preview.conflicts) {
          initialResolutions[conflict.path] = "keep_local";
        }
      }
      setResolutions(initialResolutions);

      if (preview.hasConflicts) {
        setPreviewOpen(true);
      } else if (preview.incomingUpdatesCount === 0) {
        showToast("Your repository is up-to-date", "success");
      } else {
        // No conflicts -> sync directly
        await executeSync(null);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to plan sync", "error");
    } finally {
      setFetchingPreview(false);
    }
  };

  const executeSync = async (resMap: Record<string, "keep_local" | "overwrite_github"> | null) => {
    setSyncing(true);
    try {
      await onSync(project.id, resMap);
      showToast(`Sync triggered for "${project.title}"`, "success");
    } catch (err: any) {
      showToast(err.message || "Failed to trigger sync", "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmSync = async () => {
    setPreviewOpen(false);
    await executeSync(resolutions);
  };

  const toggleResolution = (path: string, mode: "keep_local" | "overwrite_github") => {
    setResolutions((prev) => ({
      ...prev,
      [path]: mode,
    }));
  };

  const handleOverwriteAll = () => {
    if (!previewData?.conflicts) return;
    const updated: Record<string, "keep_local" | "overwrite_github"> = {};
    for (const conflict of previewData.conflicts) {
      updated[conflict.path] = "overwrite_github";
    }
    setResolutions(updated);
  };

  const handleKeepAllLocal = () => {
    if (!previewData?.conflicts) return;
    const updated: Record<string, "keep_local" | "overwrite_github"> = {};
    for (const conflict of previewData.conflicts) {
      updated[conflict.path] = "keep_local";
    }
    setResolutions(updated);
  };

  const isFailed = project.syncStatus === "failed";
  const hasOverwrites = Object.values(resolutions).some((val) => val === "overwrite_github");

  const filteredConflicts = previewData?.conflicts?.filter((c: any) =>
    c.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const statusLabels = {
    pending: "Queued",
    cloning: "Cloning",
    indexing: "Indexing",
    ready: "Ready",
    failed: "Failed",
  };

  const shortSha = project.lastCommitSha ? project.lastCommitSha.slice(0, 7) : null;
  const repoName = parseRepoName(project.repoUrl);
  const commitUrl = project.repoUrl && shortSha ? `${project.repoUrl.replace(/\/$/, "")}/commit/${project.lastCommitSha}` : null;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200/80 bg-white p-3.5 transition duration-200 hover:shadow-sm dark:border-zinc-800/85 dark:bg-zinc-900/50 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={`/project/${project.id}`}
              className="text-sm font-semibold text-zinc-900 hover:text-blue-600 hover:underline dark:text-zinc-100 dark:hover:text-blue-400"
            >
              {project.title}
            </a>
            <span className="text-zinc-300 dark:text-zinc-700 text-xs">/</span>
            {project.repoUrl ? (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {repoName}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-xs text-zinc-400">No Repo Url</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-300">
              <GitBranch className="h-3.5 w-3.5" />
              {project.defaultBranch}
            </span>
            {shortSha && (
              commitUrl ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-blue-600 hover:underline px-1.5 py-0.5 rounded dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-450 dark:hover:text-blue-400 text-[10px] transition duration-200"
                >
                  {shortSha}
                </a>
              ) : (
                <span className="font-mono bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded dark:bg-zinc-800 dark:text-zinc-455 text-[10px]">
                  {shortSha}
                </span>
              )
            )}
            {lastSync && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Synced {lastSync}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 sm:border-t-0 sm:pt-0 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            {isSyncing && (
              <div className="flex flex-col gap-1 items-start min-w-[140px]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {statusLabels[project.syncStatus as keyof typeof statusLabels]}
                    {project.syncProgress ? ` (${project.syncProgress.processed}/${project.syncProgress.total})` : ""}
                  </span>
                </div>
                {project.syncProgress && (
                  <div className="w-24 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-0.5">
                    <div
                      className="bg-blue-500 h-full transition-all duration-300"
                      style={{ width: `${project.syncProgress.percentage}%` }}
                    />
                  </div>
                )}
                {project.syncProgress?.message && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-[180px]" title={project.syncProgress.message}>
                    {project.syncProgress.message}
                  </span>
                )}
              </div>
            )}
            {isFailed && (
              <div className="flex items-center gap-1.5 text-red-655 dark:text-red-400" title="Synchronization failed. Click Sync Repository to retry.">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="text-xs font-semibold">Sync Failed</span>
              </div>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleSyncClick}
            disabled={syncing || fetchingPreview}
            className="h-8 rounded-lg shrink-0 px-2.5 font-semibold text-xs border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            {syncing || fetchingPreview ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-zinc-500" />
                {fetchingPreview ? "Checking..." : "Syncing..."}
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-zinc-500" />
                Sync Repository
              </>
            )}
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
              Sync Conflict Resolution
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Manual workspace changes clash with incoming GitHub edits. Select which changes to retain.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-955/20 border border-amber-200/60 dark:border-amber-900/40 p-3 text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-normal font-medium">
                Overwriting will drop your local modifications in NB. Keeping local versions will ignore the incoming commit updates for those files.
              </div>
            </div>

            {previewData?.incomingUpdatesCount ? (
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {previewData.incomingUpdatesCount} non-conflicting files will update safely.
              </div>
            ) : null}

            {previewData?.conflicts?.length ? (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search conflicting files by name or path..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-lg py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                <div className="text-[11px] font-bold text-zinc-450 uppercase tracking-wider">
                  Conflicting Files ({previewData?.conflicts?.length || 0})
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleKeepAllLocal}
                    className="text-[10px] font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-2.5 py-1 rounded-md transition duration-200 select-none"
                  >
                    Keep All Local
                  </button>
                  <button
                    type="button"
                    onClick={handleOverwriteAll}
                    className="text-[10px] font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-955/20 dark:hover:bg-red-955/30 px-2.5 py-1 rounded-md transition duration-200 select-none"
                  >
                    Overwrite All
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {filteredConflicts.map((item: any) => (
                  <div
                    key={item.path}
                    className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/25"
                  >
                    {/* Column 1: Path details */}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={item.path}>
                        {item.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate" title={item.path}>
                        {item.path}
                      </div>
                    </div>

                    {/* Columns 2 & 3: Status tag & Actions side-by-side to prevent overlaps */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-medium bg-amber-50 dark:bg-amber-955/30 text-amber-800 dark:text-amber-300 border border-amber-200/50 dark:border-amber-900/30">
                        Modified
                      </span>

                      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <button
                          type="button"
                          onClick={() => toggleResolution(item.path, "keep_local")}
                          className={cn(
                            "px-2.5 py-1 text-[10px] font-bold rounded-md transition duration-200 select-none",
                            resolutions[item.path] === "keep_local"
                              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                          )}
                        >
                          Keep Local
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleResolution(item.path, "overwrite_github")}
                          className={cn(
                            "px-2.5 py-1 text-[10px] font-bold rounded-md transition duration-200 select-none",
                            resolutions[item.path] === "overwrite_github"
                              ? "bg-white text-red-655 shadow-sm dark:bg-zinc-700 dark:text-red-400"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                          )}
                        >
                          Overwrite
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredConflicts.length === 0 && searchQuery && (
                  <div className="text-center py-6 text-xs text-zinc-400">
                    No conflicting files match your search query.
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-850">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
              {!hasOverwrites && (
                <>
                  <Info className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  All files set to Keep Local. Overwrite at least one file to sync.
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmSync}
                disabled={!hasOverwrites}
                className={cn(
                  "rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700",
                  !hasOverwrites && "opacity-50 cursor-not-allowed"
                )}
              >
                Confirm & Sync
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
function ExternalServiceRow({
  service,
}: {
  service: ServiceIntegrationConnection;
}) {
  const queryClient = useQueryClient();
  const lastUsed = formatRelativeTimestamp(service.lastUsedAt);
  const [disconnecting, setDisconnecting] = useState(false);
  const { showToast } = useToast();

  const handleSyncProject = async (
    projectId: string,
    resolutions?: Record<string, 'keep_local' | 'overwrite_github'> | null,
  ) => {
    const result = await retryGithubImportAction(projectId, resolutions);
    if (!result.success) {
      throw new Error(result.error || "Failed to trigger sync");
    }
    // Invalidate query to refetch integrations data
    void queryClient.invalidateQueries({
      queryKey: queryKeys.settings.integrations(),
    });
  };

  const handleDisconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast("Session not found.", "error");
        setDisconnecting(false);
        return;
      }

      const identity = user.identities?.find(
        (id: any) => id.provider.trim().toLowerCase() === "github"
      );

      if (!identity) {
        showToast("No linked GitHub identity found.", "error");
        setDisconnecting(false);
        return;
      }

      const { error } = await supabase.auth.unlinkIdentity(identity);

      if (error) {
        showToast(error.message || "Failed to disconnect GitHub", "error");
      } else {
        showToast("GitHub account disconnected successfully.", "success");
        void queryClient.invalidateQueries({
          queryKey: queryKeys.settings.integrations(),
        });
      }
    } catch (err: any) {
      showToast(err.message || "Failed to disconnect GitHub", "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = service.status === "connected" || service.status === "available";

  if (isConnected) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 dark:border-zinc-800 dark:bg-zinc-950/40 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {service.githubAvatarUrl ? (
              <img
                src={service.githubAvatarUrl}
                alt={service.githubUsername || "GitHub Avatar"}
                className="h-12 w-12 rounded-full border border-zinc-200 dark:border-zinc-800 object-cover hover:scale-105 transition duration-200"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 font-semibold text-lg hover:scale-105 transition duration-200">
                {service.githubUsername ? service.githubUsername.slice(0, 2).toUpperCase() : <Github className="h-6 w-6" />}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>{service.githubFullName || "GitHub Connected"}</span>
              </div>
              {service.githubUsername && (
                <a
                  href={`https://github.com/${service.githubUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400 flex items-center gap-1 font-medium mt-0.5"
                >
                  @{service.githubUsername}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="w-fit rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-900/50 px-3 py-1 font-semibold text-xs transition duration-200 select-none">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5 shrink-0" />
              Connected
            </Badge>
            {service.canUnlink ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disconnecting}
                onClick={handleDisconnect}
                className="h-8 rounded-lg text-xs font-semibold text-red-650 hover:text-red-750 border-zinc-200 hover:bg-red-50 dark:border-zinc-800 dark:hover:bg-red-950/20 dark:text-red-400 dark:hover:text-red-300"
              >
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                className="h-8 rounded-lg text-xs font-semibold border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-650"
                title="To disconnect GitHub, set a password or link another sign-in method first."
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-200/80 pt-4 dark:border-zinc-800/80 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Connected Repository Projects ({service.projects?.length || 0})
          </div>
          {service.projects && service.projects.length > 0 ? (
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
              {service.projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onSync={handleSyncProject}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center dark:border-zinc-800">
              <AlertCircle className="mx-auto h-8 w-8 text-zinc-400 dark:text-zinc-500" />
              <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No connected repositories
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                None of your active workspace projects are imported from GitHub.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not connected state
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
          <Github className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {service.label}
            </div>
            {service.usageCount > 0 ? (
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {service.usageCount} project
                {service.usageCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {service.summary}
          </div>
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {service.detail}
          </div>
          {lastUsed ? (
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Last synced {lastUsed}
            </div>
          ) : null}
        </div>
      </div>

      <Badge
        className={cn(
          "shrink-0 rounded-full px-3 py-1 font-medium",
          SERVICE_BADGE_STYLES[service.status],
        )}
      >
        {SERVICE_BADGE_COPY[service.status]}
      </Badge>
    </div>
  );
}

function IntegrationsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-6 w-52" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-8 w-40 rounded-full" />
        </div>
      </div>
      {[0, 1].map((section) => (
        <div
          key={section}
          className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-full max-w-lg" />
          <div className="mt-5 space-y-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

function IntegrationsSettingsContent() {
  const { data, isLoading, error } = useIntegrationsData();
  const {
    data: extensionSessionData,
    isLoading: loadingSessions,
    refetch: refetchExtensionSessions,
  } = useExtensionSessionsData();
  const enableEmailSignInMutation = useEnableEmailSignIn();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback");
  const callbackState = searchParams.get("state");
  const callbackEditorTheme = getCallbackEditorTheme(callbackUrl);
  const CallbackEditorIcon = callbackEditorTheme.icon;
  const [authorizing, setAuthorizing] = useState(false);

  const handleAuthorizeExtension = async () => {
    if (!callbackUrl) return;
    setAuthorizing(true);
    try {
      const editorName = getCallbackEditorName(callbackUrl);
      const res = await generateExtensionAuthCode(editorName, {
        authMethod: "web_login",
        requestState: callbackState,
      });
      if (res.success) {
        showToast("Authorized. Redirecting back to your editor...", "success");
        const redirectUrl = new URL(callbackUrl);
        redirectUrl.searchParams.set("code", res.code);
        if (callbackState) {
          redirectUrl.searchParams.set("state", callbackState);
        }
        window.location.href = redirectUrl.toString();
      } else {
        showToast(("error" in res ? res.error : null) || "Failed to authorize extension.", "error");
      }
    } catch {
      showToast("An error occurred during authorization.", "error");
    } finally {
      setAuthorizing(false);
    }
  };

  const [emailSignInOpen, setEmailSignInOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpMethods, setStepUpMethods] = useState<SecurityStepUpMethod[]>(
    [],
  );
  const [primaryTotpFactorId, setPrimaryTotpFactorId] = useState<
    string | undefined
  >();
  const [linkingProviderId, setLinkingProviderId] = useState<string | null>(
    null,
  );
  const passwordPolicy = useMemo(
    () => getPasswordPolicyResult(newPassword),
    [newPassword],
  );

  // Extension device sessions management state
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null,
  );
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );
  const [fallbackTokenOpen, setFallbackTokenOpen] = useState(false);
  const [additionalExtensionSessions, setAdditionalExtensionSessions] =
    useState<ExtensionSession[]>([]);
  const [extensionSessionsCursor, setExtensionSessionsCursor] = useState<
    string | null
  >(null);
  const [hasMoreExtensionSessions, setHasMoreExtensionSessions] =
    useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);

  // Token generation state
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    setAdditionalExtensionSessions([]);
    setExtensionSessionsCursor(extensionSessionData?.nextCursor ?? null);
    setHasMoreExtensionSessions(extensionSessionData?.hasMore ?? false);
  }, [extensionSessionData]);

  const extensionSessions = useMemo(() => {
    const byId = new Map<string, ExtensionSession>();
    for (const session of extensionSessionData?.sessions ?? []) {
      byId.set(session.id, session);
    }
    for (const session of additionalExtensionSessions) {
      byId.set(session.id, session);
    }
    return Array.from(byId.values());
  }, [additionalExtensionSessions, extensionSessionData?.sessions]);

  const handleLoadMoreSessions = async () => {
    if (!extensionSessionsCursor || loadingMoreSessions) return;
    setLoadingMoreSessions(true);
    const result = await getActiveExtensionSessions({
      cursor: extensionSessionsCursor,
      limit: 50,
    });
    if (result.success && result.sessions) {
      setAdditionalExtensionSessions((current) => [
        ...current,
        ...result.sessions.map((session) => ({
          ...session,
          expiresAt: new Date(session.expiresAt).toISOString(),
          lastSeenAt: new Date(session.lastSeenAt).toISOString(),
          createdAt: new Date(session.createdAt).toISOString(),
        })),
      ]);
      setExtensionSessionsCursor(result.nextCursor ?? null);
      setHasMoreExtensionSessions(result.hasMore ?? false);
    } else {
      showToast(
        result.error || "Could not load more editor sessions.",
        "error",
      );
    }
    setLoadingMoreSessions(false);
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    const res = await revokeExtensionSession(sessionId);
    if (res.success) {
      showToast("The editor extension session was revoked.", "success");
      await refetchExtensionSessions();
    } else {
      showToast(
        res.error || "Could not revoke active session. Please try again.",
        "error",
      );
    }
    setRevokingSessionId(null);
  };

  const handleGenerateToken = async () => {
    if (!newTokenName.trim()) {
      showToast(
        "Please specify a device description name for the token.",
        "error",
      );
      return;
    }
    setGeneratingToken(true);
    const res = await generateExtensionToken(newTokenName, {
      authMethod: "manual_token",
    });
    if (res.success && res.rawToken) {
      setGeneratedToken(res.rawToken);
      setNewTokenName("");
      showToast("Copy-paste fallback token generated successfully.", "success");
      await refetchExtensionSessions();
    } else {
      showToast(res.error || "Failed to generate token.", "error");
    }
    setGeneratingToken(false);
  };

  const handleCopyToken = () => {
    if (!generatedToken) return;
    navigator.clipboard.writeText(generatedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
    showToast("Token copied to clipboard.", "success");
  };

  const handleCopySessionDiagnostics = async (session: ExtensionSession) => {
    const presentation = getSessionPresentation(session);
    const diagnostics = {
      sessionId: session.id,
      device: presentation.title,
      authMethod: presentation.authLabel,
      extensionVersion: session.clientVersion,
      editorHost: session.editorHost ?? null,
      editorName: session.editorName ?? null,
      editorPlatform: session.editorPlatform ?? null,
      editorVersion: session.editorVersion ?? null,
      operatingSystem: presentation.platformLabel ?? null,
      scopes: getScopesLabel(session.scopes),
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      tokenPrefix: session.tokenPrefix ?? null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      showToast("Session diagnostics copied.", "success");
    } catch {
      showToast("Could not copy diagnostics.", "error");
    }
  };

  const errorMessage = (() => {
    if (!error) return null;
    if (error instanceof Error) return error.message;
    return "Unable to load connected account details.";
  })();

  const primaryProvider = useMemo(
    () =>
      data?.authConnections.find((provider) => provider.state === "primary") ??
      null,
    [data?.authConnections],
  );
  const latestExtensionSession = extensionSessions[0] ?? null;
  const latestExtensionSessionPresentation = latestExtensionSession
    ? getSessionPresentation(latestExtensionSession)
    : null;
  const showRecommendedConnectionPath =
    !loadingSessions && extensionSessions.length === 0;

  const resetEmailForm = () => {
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleLinkOAuthProvider = async (providerId: "google" | "github") => {
    if (linkingProviderId) return;
    setLinkingProviderId(providerId);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.linkIdentity({
        provider: providerId,
        options: {
          redirectTo: `${window.location.origin}/settings/integrations`,
        },
      });

      if (error) {
        showToast(error.message || `Failed to link ${providerId}`, "error");
        setLinkingProviderId(null);
      }
    } catch {
      showToast(`Failed to link ${providerId}`, "error");
      setLinkingProviderId(null);
    }
  };

  async function loadStepUpOptions() {
    const payload = await fetchSecurityStepUpCapabilities();
    const nextMethods = payload.availableMethods.filter(
      (method): method is SecurityStepUpMethod =>
        method === "totp" || method === "recovery_code",
    );
    if (nextMethods.length === 0) {
      throw new Error(
        "No additional verification method is available for this account.",
      );
    }

    setPrimaryTotpFactorId(payload.primaryTotpFactorId);
    setStepUpMethods(nextMethods);
    setStepUpOpen(true);
  }

  async function submitEnableEmailSignIn() {
    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }

    if (!passwordPolicy.ok) {
      showToast(
        passwordPolicy.error || "Password does not meet security requirements",
        "error",
      );
      return;
    }

    try {
      const result = await enableEmailSignInMutation.mutateAsync({
        newPassword,
      });

      if (!result.success) {
        const errorCode = "errorCode" in result ? result.errorCode : undefined;
        if (errorCode === "STEP_UP_REQUIRED") {
          try {
            await loadStepUpOptions();
          } catch (stepUpError) {
            showToast(
              stepUpError instanceof Error
                ? stepUpError.message
                : "Unable to load verification methods.",
              "error",
            );
          }
          return;
        }

        showToast(result.message || "Failed to enable email sign-in", "error");
        return;
      }

      showToast(
        "Password added successfully. Email sign-in is now enabled for this account",
        "success",
      );
      resetEmailForm();
      setEmailSignInOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.settings.integrations(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.settings.security(),
        }),
      ]);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to enable email sign-in",
        "error",
      );
    }
  }

  if (isLoading) {
    return <IntegrationsSkeleton />;
  }

  return (
    <div className="space-y-6">
      {callbackUrl ? (
        <div className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/10 space-y-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                callbackEditorTheme.containerClass,
              )}
              title={callbackEditorTheme.label}
            >
              <CallbackEditorIcon className={callbackEditorTheme.iconClassName} />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Editor Extension Connection Request
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {getCallbackEditorName(callbackUrl)} is requesting access to
                your projects. Authorizing creates a secure, revocable editor
                session for this device.
              </div>
            </div>
          </div>
          <div className="flex gap-2.5 pt-1">
            <Button
              type="button"
              onClick={handleAuthorizeExtension}
              disabled={authorizing}
              className="text-xs px-4 h-9 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-xl"
            >
              {authorizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Authorizing...
                </>
              ) : (
                "Authorize & Connect"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete("callback");
                window.history.replaceState({}, "", url.toString());
              }}
              disabled={authorizing}
              className="text-xs px-4 h-9 rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              Account created with
            </div>
            <div className="mt-2 flex items-center gap-3">
              {primaryProvider ? (
                <ProviderGlyph provider={primaryProvider.provider} />
              ) : null}
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {data?.createdWithLabel || "Unknown"}
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              {data?.summary}
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{data?.recommendedNextStep}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {data?.linkedCount ?? 0} sign-in method
              {(data?.linkedCount ?? 0) === 1 ? "" : "s"}
            </Badge>
            <Badge className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {data?.additionalLinkedCount ?? 0} additional link
              {(data?.additionalLinkedCount ?? 0) === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
      </section>

      <SettingsSectionCard
        title="Account Connections"
        description="See which sign-in methods are attached to this account."
      >
        <div className="space-y-3">
          {data?.authConnections.map((provider) => {
            const showEmailAction =
              provider.provider === "email" &&
              provider.state === "not_linked" &&
              data.capabilities.canEnableEmailSignIn;

            const showLinkAction =
              (provider.provider === "google" ||
                provider.provider === "github") &&
              provider.state === "not_linked" &&
              data.capabilities.canLinkAdditionalProvider;

            return (
              <Fragment key={provider.provider}>
                <ProviderRow
                  provider={provider}
                  onEnableEmailSignIn={
                    showEmailAction
                      ? () => setEmailSignInOpen((current) => !current)
                      : undefined
                  }
                  enablingEmailSignIn={showEmailAction && emailSignInOpen}
                  onLinkProvider={
                    showLinkAction
                      ? () =>
                          void handleLinkOAuthProvider(
                            provider.provider as "google" | "github",
                          )
                      : undefined
                  }
                  isLinkingProvider={linkingProviderId === provider.provider}
                />
                {showEmailAction && emailSignInOpen ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Set a password
                    </div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Set a password to enable email sign-in for{" "}
                      {data.emailAddress}. Google and GitHub stay linked.
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="integrations-email-password">
                          New password
                        </Label>
                        <Input
                          id="integrations-email-password"
                          type="password"
                          value={newPassword}
                          onChange={(event) =>
                            setNewPassword(event.target.value)
                          }
                          disabled={enableEmailSignInMutation.isPending}
                        />
                        <PasswordStrengthMeter password={newPassword} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="integrations-email-password-confirm">
                          Confirm password
                        </Label>
                        <Input
                          id="integrations-email-password-confirm"
                          type="password"
                          value={confirmPassword}
                          onChange={(event) =>
                            setConfirmPassword(event.target.value)
                          }
                          disabled={enableEmailSignInMutation.isPending}
                        />
                        {confirmPassword && newPassword !== confirmPassword ? (
                          <p className="text-xs text-red-500">
                            Passwords do not match.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                      Use at least {PASSWORD_MIN_LENGTH} characters. This
                      enables email/password access on the current account email
                      and does not create a second account.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={() => void submitEnableEmailSignIn()}
                        disabled={
                          enableEmailSignInMutation.isPending ||
                          !passwordPolicy.ok
                        }
                      >
                        {enableEmailSignInMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Set a password"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={enableEmailSignInMutation.isPending}
                        onClick={() => {
                          resetEmailForm();
                          setEmailSignInOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Google and GitHub reflect linked providers. Email sign-in uses the
            current account email and is enabled by setting a password when
            available.
          </span>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{data?.infoNote}</span>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="External Services"
        description="Service connections used by product features on this account."
      >
        <div className="space-y-3">
          {data?.externalServices.map((service) => (
            <ExternalServiceRow key={service.id} service={service} />
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            GitHub here refers to repository import and sync usage inside the
            product, separate from how you originally signed in.
          </span>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="Editor Extension Connection"
        description="Connect NB Workspace to VS Code, Cursor, Windsurf, or any compatible editor extension."
      >
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Status
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    extensionSessions.length > 0
                      ? "bg-emerald-500"
                      : "bg-zinc-400",
                  )}
                />
                {extensionSessions.length > 0 ? "Connected" : "Disconnected"}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Active editors
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {extensionSessions.length} session
                {extensionSessions.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Latest activity
              </div>
              <div className="mt-3 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {latestExtensionSessionPresentation?.lastActiveLabel ??
                  "No activity yet"}
              </div>
            </div>
          </div>

          {showRecommendedConnectionPath ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-950/40 dark:bg-blue-950/10">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Recommended connection path
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Use web sign-in from your editor extension. Manual tokens stay
                  available only as a fallback when browser login is blocked.
                </p>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Active Editor Sessions
                </h4>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Raw session identifiers are hidden by default. Use details
                  only for diagnostics or support.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refetchExtensionSessions()}
                disabled={loadingSessions}
                className="h-8 rounded-lg"
              >
                {loadingSessions ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Refresh
              </Button>
            </div>

            {loadingSessions && extensionSessions.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : extensionSessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-800">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm">
                  <ExtensionAppIcon className="h-7 w-7" />
                </div>
                <div className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  No active editor sessions
                </div>
                <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                  Sign in from the NB Workspace extension in VS Code, Cursor,
                  Windsurf, or another compatible editor to create a revocable
                  session here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {extensionSessions.map((session) => (
                  <ExtensionSessionRow
                    key={session.id}
                    session={session}
                    expanded={expandedSessionId === session.id}
                    revoking={revokingSessionId === session.id}
                    onToggleAdvanced={() =>
                      setExpandedSessionId((current) =>
                        current === session.id ? null : session.id,
                      )
                    }
                    onCopyDiagnostics={() =>
                      void handleCopySessionDiagnostics(session)
                    }
                    onRevoke={() => void handleRevokeSession(session.id)}
                  />
                ))}
                {hasMoreExtensionSessions ? (
                  <div className="flex justify-center p-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loadingMoreSessions}
                      onClick={() => void handleLoadMoreSessions()}
                    >
                      {loadingMoreSessions ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Load more sessions
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setFallbackTokenOpen((current) => !current)}
              className="flex w-full items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4 text-left transition hover:bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-950/30 dark:hover:bg-zinc-900/70"
              aria-expanded={fallbackTokenOpen}
            >
              <span className="flex min-w-0 gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <KeyRound className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Having trouble with web sign-in?
                  </span>
                  <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                    Generate a fallback token only when your OS, browser, or
                    firewall blocks the editor redirect.
                  </span>
                </span>
              </span>
              {fallbackTokenOpen ? (
                <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-zinc-500" />
              ) : (
                <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-zinc-500" />
              )}
            </button>

            {fallbackTokenOpen ? (
              <div className="mt-4 space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="rounded-xl bg-amber-50 px-3 py-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  Fallback tokens are extension-scoped and revocable. Treat the
                  generated value like a password; it is shown once.
                </div>

                {!generatedToken ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="text"
                      placeholder="Device description, e.g. Cursor on work laptop"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      disabled={generatingToken}
                      className="max-w-md rounded-xl text-sm"
                      data-testid="device-token-name-input"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleGenerateToken()}
                      disabled={generatingToken}
                      className="shrink-0 rounded-xl"
                    >
                      {generatingToken ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Generate fallback token"
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-950/30 dark:bg-blue-950/10">
                    <div className="text-xs font-medium text-blue-800 dark:text-blue-300">
                      Copy your new token now. It will not be shown again.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        readOnly
                        value={generatedToken}
                        className="w-full rounded-xl border border-zinc-300 bg-white p-2.5 font-mono text-xs text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        type="button"
                        onClick={handleCopyToken}
                        className="shrink-0 rounded-xl"
                      >
                        {copiedToken ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setGeneratedToken(null)}
                      className="h-8 rounded-xl text-xs"
                    >
                      Done
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </SettingsSectionCard>

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Complete one more check before setting a password for email sign-in."
        availableMethods={stepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={async () => {
          await submitEnableEmailSignIn();
        }}
      />
    </div>
  );
}

export default function IntegrationsSettings() {
  return (
    <Suspense fallback={<IntegrationsSkeleton />}>
      <IntegrationsSettingsContent />
    </Suspense>
  );
}
