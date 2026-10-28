import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: [path.join(web, "index.html"), path.join(web, "src", "**", "*.{ts,tsx}")],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      fontSize: { base: ["14px", "20px"] },
      colors: {
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        canvas: token("canvas"),
        foreground: token("foreground"),
        primary: {
          DEFAULT: token("primary"),
          hover: token("primary-hover"),
          active: token("primary-active"),
          foreground: token("primary-foreground"),
          subtle: token("primary-subtle"),
        },
        secondary: { DEFAULT: token("secondary"), foreground: token("secondary-foreground") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        destructive: { DEFAULT: token("destructive"), foreground: token("destructive-foreground") },
        popover: { DEFAULT: token("popover"), foreground: token("popover-foreground") },
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        status: {
          ok: token("status-ok"),
          warn: token("status-warn"),
          error: token("status-error"),
          info: token("status-info"),
          neutral: token("status-neutral"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.04)",
      },
      maxWidth: { content: "1280px" },
    },
  },
  plugins: [animate],
} satisfies Config;
