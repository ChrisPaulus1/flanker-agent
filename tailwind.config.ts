import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1200px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Signal-level accents, defined once so cards, badges and the email
        // template can't drift apart.
        signal: {
          high: "hsl(var(--signal-high))",
          medium: "hsl(var(--signal-medium))",
          low: "hsl(var(--signal-low))",
        },
        // Three accents, two weights each. The bright value is the mark —
        // rails, bars, icons; the `ink` value is the only one dark enough to
        // set text on white at 4.5:1.
        tangerine: {
          DEFAULT: "hsl(var(--tangerine))",
          ink: "hsl(var(--tangerine-ink))",
        },
        teal: {
          DEFAULT: "hsl(var(--teal))",
          ink: "hsl(var(--teal-ink))",
        },
        indigo: {
          DEFAULT: "hsl(var(--indigo))",
          ink: "hsl(var(--indigo-ink))",
        },
        // Page tints, drawn from the three accents.
        wash: {
          a: "hsl(var(--wash-a))",
          b: "hsl(var(--wash-b))",
          c: "hsl(var(--wash-c))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "collapsible-down": {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
