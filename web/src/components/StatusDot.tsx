import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  error: "bg-status-error",
  info: "bg-status-info",
  neutral: "bg-status-neutral",
};

export function StatusDot({ tone, live = false, className }: { tone: Tone; live?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex h-2 w-2 shrink-0", className)}>
      {live ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", TONE_CLASS[tone])} /> : null}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", TONE_CLASS[tone])} />
    </span>
  );
}
