import { cn } from "@/lib/utils";

/** Same paths, in the same order, as web/public/brand/mark.svg. */
export const MARK_PATHS: readonly { d: string; fill: string }[] = [
  { d: "M190 258 C162 214 128 166 92 128 C106 176 140 222 178 266 Z", fill: "#27272a" },
  { d: "M186 266 C150 232 112 200 70 180 C90 222 128 252 176 276 Z", fill: "#52525b" },
  { d: "M182 276 C142 256 100 242 56 238 C82 270 124 284 174 288 Z", fill: "#71717a" },
  { d: "M178 288 C140 284 104 286 70 298 C100 312 140 308 176 300 Z", fill: "#a1a1aa" },
  { d: "M196 246 C176 248 164 268 170 296 C176 280 186 266 200 260 Z", fill: "#18181b" },
  { d: "M322 258 C350 214 384 166 420 128 C406 176 372 222 334 266 Z", fill: "#27272a" },
  { d: "M326 266 C362 232 400 200 442 180 C422 222 384 252 336 276 Z", fill: "#52525b" },
  { d: "M330 276 C370 256 412 242 456 238 C430 270 388 284 338 288 Z", fill: "#71717a" },
  { d: "M334 288 C372 284 408 286 442 298 C412 312 372 308 336 300 Z", fill: "#a1a1aa" },
  { d: "M316 246 C336 248 348 268 342 296 C336 280 326 266 312 260 Z", fill: "#18181b" },
  { d: "M176 300 C176 214 212 160 256 160 C300 160 336 214 336 300 Z", fill: "#0a0a0a" },
  { d: "M214 230 C216 198 232 178 252 172 C238 188 228 208 226 234 Z", fill: "#71717a" },
  { d: "M178 270 C230 262 282 262 334 270 L336 290 C282 282 230 282 176 290 Z", fill: "#3f3f46" },
  { d: "M140 300 C200 286 312 286 372 300 C312 318 200 318 140 300 Z", fill: "#18181b" },
];

export function BrandMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="52 122 408 200"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {title ? <title>{title}</title> : null}
      <g>
        {MARK_PATHS.map((p) => (
          <path key={p.d} d={p.d} fill={p.fill} />
        ))}
      </g>
    </svg>
  );
}
