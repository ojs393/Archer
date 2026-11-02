import { cn } from "@/lib/utils";

/** Same paths, in the same order, as web/public/brand/mark.svg. */
export const MARK_PATHS: readonly { d: string; fill: string }[] = [
  { d: "M190 246 L78 112 L98 250 Z", fill: "#1E293B" },
  { d: "M186 260 L52 176 L92 276 Z", fill: "#334155" },
  { d: "M182 276 L44 236 L90 298 Z", fill: "#5B6B7C" },
  { d: "M178 292 L56 278 L96 318 Z", fill: "#0D9488" },
  { d: "M206 236 L152 244 L158 308 L210 264 Z", fill: "#0F172A" },
  { d: "M322 246 L434 112 L414 250 Z", fill: "#1E293B" },
  { d: "M326 260 L460 176 L420 276 Z", fill: "#334155" },
  { d: "M330 276 L468 236 L422 298 Z", fill: "#5B6B7C" },
  { d: "M334 292 L456 278 L416 318 Z", fill: "#0D9488" },
  { d: "M306 236 L360 244 L354 308 L302 264 Z", fill: "#0F172A" },
  { d: "M168 304 C168 196 208 132 256 132 C304 132 344 196 344 304 Z", fill: "#0B0F14" },
  { d: "M212 214 C214 178 236 154 254 148 C240 168 228 194 226 218 Z", fill: "#94A3B8" },
  { d: "M172 266 C228 252 284 252 340 266 L342 290 C284 276 228 276 170 290 Z", fill: "#334155" },
  { d: "M128 304 C196 278 316 278 384 304 C316 334 196 334 128 304 Z", fill: "#0F172A" },
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
