export interface AnsiSegment {
  text: string;
  className: string;
}

const CODE_MAP: Record<number, string> = {
  0: "",
  1: "font-bold",
  2: "opacity-60",
  30: "text-zinc-900 dark:text-zinc-100",
  31: "text-red-500",
  32: "text-emerald-500",
  33: "text-yellow-500",
  34: "text-blue-500",
  35: "text-purple-500",
  36: "text-cyan-500",
  37: "text-zinc-300 dark:text-zinc-400",
  90: "text-zinc-500",
  91: "text-red-400",
  92: "text-emerald-400",
  93: "text-yellow-400",
  94: "text-blue-400",
  95: "text-purple-400",
  96: "text-cyan-400",
  97: "text-white",
};

export function parseAnsi(input: string): AnsiSegment[] {
  const ANSI_RE = /\x1b\[(\d+(?:;\d+)*)m/g;
  const segments: AnsiSegment[] = [];
  let lastIndex = 0;
  let activeClasses = "";

  let match: RegExpExecArray | null;
  while ((match = ANSI_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index), className: activeClasses });
    }
    const codes = match[1].split(";").map(Number);
    const classes: string[] = [];
    for (const code of codes) {
      if (code === 0) {
        activeClasses = "";
        continue;
      }
      const cls = CODE_MAP[code];
      if (cls) classes.push(cls);
    }
    if (classes.length) activeClasses = classes.join(" ");
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), className: activeClasses });
  }
  if (segments.length === 0 && input.length > 0) {
    segments.push({ text: input, className: "" });
  }
  return segments;
}
