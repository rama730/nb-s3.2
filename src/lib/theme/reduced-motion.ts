export function prefersReducedMotionFromSystem(matchMediaFn: typeof window.matchMedia | null | undefined): boolean {
  try {
    if (!matchMediaFn) return false;
    return matchMediaFn("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function prefersReducedMotionFromAttributes(root: Element | null | undefined): boolean {
  if (!root) return false;
  return root.getAttribute("data-reduce-motion") === "true";
}

export function isReducedMotionEnabled(args: {
  root?: Element | null;
  matchMedia?: typeof window.matchMedia | null;
}): boolean {
  if (prefersReducedMotionFromAttributes(args.root)) return true;
  return prefersReducedMotionFromSystem(args.matchMedia);
}
