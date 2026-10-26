import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";

/** One-line code value with a borderless copy action. */
export function Copyable({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in tests or locked-down contexts.
    }
  }

  return (
    <div className={cn("flex min-w-0 items-start gap-1", className)}>
      <code className="min-w-0 flex-1 break-all rounded-md bg-zinc-100 px-2 py-1.5 font-mono text-xs text-foreground">{value}</code>
      <IconButton label={copied ? "Copied" : "Copy"} icon={copied ? Check : Copy} onClick={() => void copy()} />
    </div>
  );
}
