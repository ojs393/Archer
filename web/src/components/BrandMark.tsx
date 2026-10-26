import { cn } from "@/lib/utils";

/** Same paths, in the same order, as web/public/brand/mark.svg. */
export const MARK_PATHS: readonly { d: string; fill: string; stroke?: boolean }[] = [
  { d: "M176 236 C140 200 104 170 66 158 C94 186 128 216 168 252 Z", fill: "#3f3f46" },
  { d: "M176 258 C134 238 94 224 54 224 C86 246 126 264 172 272 Z", fill: "#71717a" },
  { d: "M174 280 C138 272 102 270 68 282 C100 294 138 294 172 290 Z", fill: "#a1a1aa" },
  { d: "M336 236 C372 200 408 170 446 158 C418 186 384 216 344 252 Z", fill: "#3f3f46" },
  { d: "M336 258 C378 238 418 224 458 224 C426 246 386 264 340 272 Z", fill: "#71717a" },
  { d: "M338 280 C374 272 410 270 444 282 C412 294 374 294 340 290 Z", fill: "#a1a1aa" },
  { d: "M168 302 C168 212 208 150 256 150 C304 150 344 212 344 302 Z", fill: "#0a0a0a" },
  { d: "M206 246 C208 204 228 176 254 166 C236 184 224 210 220 250 Z", fill: "#52525b" },
  { d: "M132 306 C190 290 322 290 380 306 C322 330 190 330 132 306 Z", fill: "#27272a" },
  { d: "M150 307 C204 296 308 296 362 307", fill: "#71717a", stroke: true },
];

export function BrandMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="54 140 404 200"
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
        {MARK_PATHS.map((p) =>
          p.stroke ? (
            <path key={p.d} d={p.d} fill="none" stroke={p.fill} strokeWidth={4} strokeLinecap="round" />
          ) : (
            <path key={p.d} d={p.d} fill={p.fill} />
          ),
        )}
      </g>
    </svg>
  );
}
