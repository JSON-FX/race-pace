/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: c("--background"),
        foreground: c("--foreground"),
        card: { DEFAULT: c("--card"), foreground: c("--card-foreground") },
        popover: { DEFAULT: c("--popover"), foreground: c("--popover-foreground") },
        muted: { DEFAULT: c("--muted"), foreground: c("--muted-foreground") },
        secondary: { DEFAULT: c("--secondary"), foreground: c("--secondary-foreground") },
        accent: { DEFAULT: c("--accent"), foreground: c("--accent-foreground") },
        primary: { DEFAULT: c("--primary"), foreground: c("--primary-foreground"), focus: c("--primary-focus") },
        destructive: { DEFAULT: c("--destructive"), foreground: c("--destructive-foreground"), tint: c("--destructive-tint") },
        border: c("--border"),
        divider: c("--divider"),
        input: c("--input"),
        ring: c("--ring"),
        forest: c("--forest"),
        paid: { DEFAULT: c("--paid"), tint: c("--paid-tint") },
        info: { DEFAULT: c("--info"), tint: c("--info-tint") },
        amber: { DEFAULT: c("--amber"), tint: c("--amber-tint") },
      },
      borderRadius: { card: "14px", pill: "9999px" },
    },
  },
  plugins: [],
};
