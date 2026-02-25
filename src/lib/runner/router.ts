import type { EngineKey } from "./types";
import { EXT_TO_ENGINE } from "./types";

export function parseCommand(cmd: string): { path: string; ext: string } | null {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const path = parts[1] ?? "";
  if (!path || path.startsWith("-")) return null;
  const lastDot = path.lastIndexOf(".");
  const ext = lastDot >= 0 ? path.slice(lastDot).toLowerCase() : "";
  return { path, ext };
}

export function getEngineByExt(ext: string): EngineKey | null {
  return EXT_TO_ENGINE[ext] ?? null;
}
