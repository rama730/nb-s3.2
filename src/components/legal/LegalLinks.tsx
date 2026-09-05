import Link from "next/link";
import { cn } from "@/lib/utils";

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/privacy">Privacy</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/terms">Terms</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/eula">EULA</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/acceptable-use">Acceptable use</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/cookies">Cookies</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/subprocessors">Providers</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/copyright">Copyright</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/grievances">Grievances</Link>
      <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/security-reporting">Security</Link>
    </nav>
  );
}
