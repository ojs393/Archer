import { cn } from "@/lib/utils";

/** Same paths, in the same order, as web/public/brand/mark.svg. */
export const MARK_PATHS: readonly { d: string; fill: string }[] = [
  { d: "M192 252 C158 200 118 148 78 108 C98 168 140 220 182 262 Z", fill: "#27272a" },
  { d: "M188 264 C146 226 100 192 54 172 C78 224 126 258 178 278 Z", fill: "#52525b" },
  { d: "M184 278 C138 254 88 240 40 236 C70 276 122 290 176 292 Z", fill: "#71717a" },
  { d: "M180 290 C136 286 94 290 56 306 C92 322 138 316 178 304 Z", fill: "#a1a1aa" },
  { d: "M200 244 C176 246 162 272 170 304 C178 284 190 268 206 260 Z", fill: "#18181b" },
  { d: "M320 252 C354 200 394 148 434 108 C414 168 372 220 330 262 Z", fill: "#27272a" },
  { d: "M324 264 C366 226 412 192 458 172 C434 224 386 258 334 278 Z", fill: "#52525b" },
  { d: "M328 278 C374 254 424 240 472 236 C442 276 390 290 336 292 Z", fill: "#71717a" },
  { d: "M332 290 C376 286 418 290 456 306 C420 322 374 316 334 304 Z", fill: "#a1a1aa" },
  { d: "M312 244 C336 246 350 272 342 304 C334 284 322 268 306 260 Z", fill: "#18181b" },
  { d: "M168 304 C168 200 208 140 256 140 C304 140 344 200 344 304 Z", fill: "#0a0a0a" },
  { d: "M210 222 C212 184 234 160 254 152 C238 172 226 198 224 226 Z", fill: "#71717a" },
  { d: "M170 268 C228 256 284 256 342 268 L344 292 C284 280 228 280 168 292 Z", fill: "#3f3f46" },
  { d: "M124 304 C196 282 316 282 388 304 C316 334 196 334 124 304 Z", fill: "#18181b" },
];

export function BrandMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="52 100 408 250"
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
