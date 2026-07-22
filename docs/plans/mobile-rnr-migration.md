# Mobile UI → React Native Reusables Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire `apps/mobile` runner UI (14 routes, 12 components) from hand-rolled `StyleSheet` to **React Native Reusables (RNR)** primitives on **NativeWind**, preserving the Race Pace brand and adding **light + dark** theming, with all 47 tests green throughout.

**Architecture:** Foundation-first and test-guarded. First a Phase 0 spike de-risks NativeWind on Expo SDK 57 / RN 0.86. Then we lay the theming foundation (semantic CSS-variable tokens in `global.css`, mapped through `tailwind.config.js`), add RNR primitives under `components/ui/`, migrate leaf components, then screens — the register→pay→ticket money path **last**. `lib/theme.ts` stays as a bridge until nothing imports it, then is deleted.

**Tech Stack:** Expo SDK 57 (RN 0.86, React 19.2) · Expo Router · NativeWind v4 (Tailwind 3.4) · React Native Reusables (copy-in) · `lucide-react-native` · Jest (jest-expo) + `@testing-library/react-native`.

**Spec:** [docs/specs/2026-07-22-mobile-rnr-migration-design.md](../specs/2026-07-22-mobile-rnr-migration-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Read the versioned Expo docs first.** `apps/mobile/AGENTS.md`: SDK 57 is new — consult `https://docs.expo.dev/versions/v57.0.0/` before writing native/config code.
- **Package manager is pnpm@9.7.0 (workspace).** NEVER run `npm install`/`npm add` — it writes a `package-lock.json` and corrupts the pnpm workspace. Installs: from repo root `pnpm --filter mobile add <pkg>` (add `-D` for dev), or `npx expo install <pkg>` (Expo detects pnpm) for Expo-versioned native deps.
- **Commands.** Baseline is **47 tests / 24 suites** (not 49). Full suite: `pnpm --filter mobile test`. One file: `pnpm --filter mobile exec jest __tests__/<file>`. Typecheck: `pnpm --filter mobile exec tsc --noEmit`. iOS render check: the `mcp__Claude_Code_iOS_Simulator__control` tool (attach → build → launch → screenshot), or `pnpm --filter mobile exec expo start --ios`. **Wherever a step below writes `npm …`/`npx jest`/`npm run ios`, use these pnpm equivalents instead.**
- **Tests stay green after every task.** Behavior tests (hooks, checkout, cache) are styling-agnostic and must pass **untouched**. A restyle-only task must not change a component's rendered text, `testID`, `accessibilityRole`, or `accessibilityLabel` — those are how the tests find nodes. If a test asserts on `style`/color (not behavior), refactor the assertion to behavior/text in the same task and say so in the commit.
- **Copy-in, not dependency.** RNR components are added via `npx @react-native-reusables/cli@latest add <name>` into `components/ui/`, then owned/edited by us. Import via the **`@/` alias** (already in `tsconfig.json` → `@/* : ./*`).
- **Brand is trail-green `#159A55`**, pill CTAs, hairline surfaces, getdesign `apple` structure. Light + dark both defined; dark values from spec §6 (tune contrast to **WCAG AA** in QA).
- **`lib/theme.ts` is the bridge.** Do not delete it until the final cleanup task; un-migrated files keep importing it. New/migrated files import brand values as NativeWind classes, not from `theme.ts`.
- **Money path (`register`/`pay`/`ticket`) is migrated last and most carefully.** Do not touch its files before Phase 4's money-path tasks.
- **No feature changes.** Preserve current behavior exactly — including `DynamicField` treating `date` as a text field and `file` as a "not supported yet" stub (real pickers are the OPTIONAL Task 18, not the restyle).
- **pnpm workspace / Metro:** `metro.config.js` is pnpm-aware (`watchFolders`, `nodeModulesPaths`, `disableHierarchicalLookup=false`). `withNativeWind(...)` must **wrap** the existing config object, preserving those fields — never replace them.

### Canonical token → NativeWind className map

Migration tasks reference this table instead of repeating it. Left = current `theme.*` / `StyleSheet` value; right = the class to use. Colors resolve to CSS variables defined in Task 2 and wired in Task 3.

| Current value | className |
| --- | --- |
| `theme.primary` `#159A55` (bg/text/border) | `bg-primary` / `text-primary` / `border-primary` |
| `theme.onPrimary` `#fff` on primary | `text-primary-foreground` |
| `theme.primaryFocus/primaryDark` `#0F7A42` | `text-paid` / `bg-paid` (paid) or `active:bg-primary-focus` |
| `theme.primaryTint` `#EAF3EE` | `bg-secondary` (secondary-foreground = `#0F7A42`) |
| `theme.forest` `#0F2A20` | `bg-forest` / `text-forest` |
| `theme.ink` `#1D1D1F` | `text-foreground` |
| `theme.inkMuted` `#7A7A7A` | `text-muted-foreground` |
| `theme.inkSubtle` `#8A8A8E` | `text-muted-foreground` |
| `theme.inkFaint` `#CCCCCC` (placeholder/chevron) | `text-muted-foreground/60` / `placeholder:text-muted-foreground/60` |
| `theme.canvas` `#fff` | `bg-background` |
| `theme.parchment` `#F5F5F7` | `bg-muted` |
| `theme.pearl` `#fafafc` | `bg-muted/50` |
| `theme.hairline` `#E0E0E0` | `border-border` |
| `theme.divider` `#EFEFF1` | `border-divider` |
| `theme.danger` `#FF3B30` / tint | `text-destructive` `bg-destructive` / `bg-destructive-tint` |
| `theme.amber` `#B45309` / tint | `text-amber` / `bg-amber-tint` |
| `theme.info` `#0066CC` / tint | `text-info` / `bg-info-tint` |
| `theme.paid` `#0F7A42` / tint | `text-paid` / `bg-paid-tint` |
| radius `pill` 9999 | `rounded-full` |
| radius `card` 14 | `rounded-card` |
| radius `lg` 18 / `xl` 22 / `md` 11 / `sm` 8 | `rounded-[18px]` / `rounded-[22px]` / `rounded-[11px]` / `rounded-[8px]` |
| space `xxs4/xs8/sm12/lg24/xl32` | `1/2/3/6/8` (e.g. `p-3`, `gap-2`) |
| space `md` 17 (off-scale) | arbitrary: `p-[17px]`, `gap-[17px]` |
| body 17/400 | `text-[17px] font-normal tracking-[-0.374px]` |
| body-strong 17/600 | `text-[17px] font-semibold tracking-[-0.374px]` |
| title 24/700 (screen h) | `text-2xl font-bold tracking-[-0.4px]` |
| label 11/600 caps | `text-[11px] font-semibold tracking-[0.4px]` |
| caption 13–14 | `text-sm` |

### Dark mode

- Dark tokens live under `.dark` in `global.css` (Task 2). The app toggles scheme via NativeWind's `colorScheme` + React Navigation `ThemeProvider` (Task 5).
- Every restyle uses **semantic** classes (`bg-background`, `text-foreground`, `border-border`, `bg-card`, …), never raw hex — so dark "just works." Verify each migrated screen in **both** light and dark in the simulator before committing (toggle: Simulator → Features → Toggle Appearance, or `npm run ios` with the device set to dark).

---

## Phase 0 — Spike (gate)

### Task 1: NativeWind + RNR spike — prove render + tests green

**Files:**
- Create: `apps/mobile/global.css`, `apps/mobile/tailwind.config.js`, `apps/mobile/nativewind-env.d.ts`
- Modify: `apps/mobile/babel.config.js` (create if absent), `apps/mobile/metro.config.js`, `apps/mobile/package.json` (jest block), `apps/mobile/app/index.tsx` (temporary probe)
- Create: `apps/mobile/components/ui/button.tsx` (via CLI)

**Interfaces:**
- Produces: a working NativeWind pipeline (babel/metro/global.css/tailwind) and one RNR `Button` at `@/components/ui/button`. Consumed by every later task.

- [ ] **Step 1: Read the versioned setup docs.** Open `https://docs.expo.dev/versions/v57.0.0/` (NativeWind + Metro/Babel sections) and `https://reactnativereusables.com/docs/installation` (Manual tab). Note the exact NativeWind + Tailwind versions RNR's template pins.

- [ ] **Step 2: Install deps.** From `apps/mobile/`:

```bash
# from repo root — pnpm workspace; Expo picks pnpm for `expo install`
npx expo install nativewind react-native-reanimated react-native-safe-area-context
pnpm --filter mobile add -D tailwindcss@^3.4.17
pnpm --filter mobile add lucide-react-native clsx tailwind-merge
```

- [ ] **Step 3: Create `global.css`** (minimal for the spike; full tokens land in Task 2):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Create `tailwind.config.js`** (minimal for the spike):

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 5: Create/patch `babel.config.js`:**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

- [ ] **Step 6: Wrap `metro.config.js` with NativeWind** (preserve the existing pnpm fields):

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 7: Create `nativewind-env.d.ts`:**

```ts
/// <reference types="nativewind/types" />
```

- [ ] **Step 8: Wire jest for the `@/` alias + NativeWind transform.** In `package.json`, extend the existing `jest` block: add `moduleNameMapper` and append `nativewind` + `react-native-css-interop` to the `transformIgnorePatterns` allowlist:

```json
"moduleNameMapper": { "^@/(.*)$": "<rootDir>/$1" }
```

Append `|nativewind|react-native-css-interop` inside the existing `transformIgnorePatterns` allowlist group (before the closing `))`).

- [ ] **Step 9: Add the RNR Button** (accept the CLI's prompts to write into `components/ui/`):

```bash
npx @react-native-reusables/cli@latest add button
```

If the CLI also wants `text`/`lib/utils`, accept them. Confirm `components/ui/button.tsx` and `lib/utils.ts` (with `cn()`) now exist.

- [ ] **Step 10: Temporary probe** — render the Button on the splash. In `app/index.tsx`, add near the existing content (remember to remove in Step 13):

```tsx
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
// ...inside the returned JSX:
<Button className="rounded-full bg-primary"><Text>Spike OK</Text></Button>
```

- [ ] **Step 11: Verify tests still pass (the critical gate).**

Run: `npm test`
Expected: PASS — all 47 tests. If NativeWind's transform breaks rendering, fix babel/jest config now (this is the spike's purpose). If any test asserts on style/color, note it for that component's Phase 3/4 task; it should not fail on a className-only probe.

- [ ] **Step 12: Verify iOS render.** Attach the simulator, build, launch, screenshot. Confirm the "Spike OK" pill renders in trail-green. (`mcp__Claude_Code_iOS_Simulator__control`: attach → build → launch → screenshot, or `npm run ios`.)

- [ ] **Step 13: Remove the probe** from `app/index.tsx` (leave the pipeline + Button in place).

- [ ] **Step 14: Commit.**

```bash
git add apps/mobile
git commit -m "chore(mobile): NativeWind + RNR spike — pipeline wired, tests green"
```

---

## Phase 1 — Theming foundation

### Task 2: Full light + dark tokens in `global.css`

**Files:**
- Modify: `apps/mobile/global.css`

**Interfaces:**
- Produces: CSS variables for `:root` (light) and `.dark` (dark): semantic (`--background`,`--foreground`,`--card`,`--popover`,`--muted`,`--secondary`,`--accent`,`--primary`,`--border`,`--input`,`--ring`,`--destructive` + their `-foreground`s) and brand-extra (`--forest`,`--divider`,`--paid`,`--paid-tint`,`--info`,`--info-tint`,`--amber`,`--amber-tint`,`--primary-focus`,`--destructive-tint`). Consumed by Task 3.

- [ ] **Step 1: Write the tokens.** RNR/NativeWind reads these as HSL-less hex via the `hsl`-free pattern; use the space-separated RGB channel convention RNR's template uses (verify against the `add`-generated `global.css` from Task 1; match its format). Values (spec §6):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 255 255 255;      /* #FFFFFF */
    --foreground: 29 29 31;         /* #1D1D1F */
    --card: 255 255 255;
    --card-foreground: 29 29 31;
    --popover: 255 255 255;
    --popover-foreground: 29 29 31;
    --muted: 245 245 247;           /* #F5F5F7 */
    --muted-foreground: 122 122 122;/* #7A7A7A */
    --secondary: 234 243 238;       /* #EAF3EE */
    --secondary-foreground: 15 122 66; /* #0F7A42 */
    --accent: 234 243 238;
    --accent-foreground: 15 122 66;
    --primary: 21 154 85;           /* #159A55 */
    --primary-foreground: 255 255 255;
    --primary-focus: 15 122 66;     /* #0F7A42 */
    --border: 224 224 224;          /* #E0E0E0 */
    --divider: 239 239 241;         /* #EFEFF1 */
    --input: 224 224 224;
    --ring: 21 154 85;
    --destructive: 255 59 48;       /* #FF3B30 */
    --destructive-foreground: 255 255 255;
    --destructive-tint: 253 236 234;/* #FDECEA */
    --forest: 15 42 32;             /* #0F2A20 */
    --paid: 15 122 66;      --paid-tint: 234 243 238;   /* #0F7A42 / #EAF3EE */
    --info: 0 102 204;      --info-tint: 232 240 251;   /* #0066CC / #E8F0FB */
    --amber: 180 83 9;      --amber-tint: 251 239 227;  /* #B45309 / #FBEFE3 */
  }
  .dark:root, .dark {
    --background: 11 15 13;         /* #0B0F0D */
    --foreground: 245 245 247;
    --card: 20 25 22;              /* #141916 */
    --card-foreground: 245 245 247;
    --popover: 20 25 22;
    --popover-foreground: 245 245 247;
    --muted: 27 33 29;            /* #1B211D */
    --muted-foreground: 161 161 166;/* #A1A1A6 */
    --secondary: 19 37 28;        /* #13251C */
    --secondary-foreground: 127 224 166; /* #7FE0A6 */
    --accent: 19 37 28;
    --accent-foreground: 127 224 166;
    --primary: 47 181 106;        /* #2FB56A */
    --primary-foreground: 6 18 11;
    --primary-focus: 30 158 92;   /* #1E9E5C */
    --border: 38 43 40;           /* #262B28 */
    --divider: 38 43 40;
    --input: 38 43 40;
    --ring: 47 181 106;
    --destructive: 255 69 58;     /* #FF453A */
    --destructive-foreground: 255 255 255;
    --destructive-tint: 42 20 20;
    --forest: 15 42 32;
    --paid: 53 192 110;   --paid-tint: 19 37 28;    /* #35C06E */
    --info: 10 132 255;   --info-tint: 16 35 58;    /* #0A84FF */
    --amber: 224 163 69;  --amber-tint: 42 33 19;   /* #E0A345 */
  }
}
```

- [ ] **Step 2: Verify format matches RNR's convention.** Compare against RNR's documented theming template (and the `global.css`/`lib` the CLI wrote in Task 1, if it scaffolded them). If RNR uses `hsl(...)` triplets instead of RGB channels, convert these values to that format (keep the same colors). The channel format here MUST match the wrapper Task 3 uses (`rgb(var(--x) / <alpha-value>)` vs `hsl(...)`).

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/global.css
git commit -m "feat(mobile): light + dark design tokens (trail-green brand)"
```

### Task 3: Map tokens + radii in `tailwind.config.js`

**Files:**
- Modify: `apps/mobile/tailwind.config.js`

**Interfaces:**
- Consumes: CSS vars from Task 2.
- Produces: Tailwind color names (`primary`, `background`, `foreground`, `card`, `muted`, `secondary`, `accent`, `border`, `divider`, `input`, `ring`, `destructive`, `forest`, `paid`, `info`, `amber`, plus `*-tint`, `*-foreground`) and `borderRadius` names `card`/`pill`. Consumed by every className in Phase 2–4.

- [ ] **Step 1: Write the config.** Use the channel wrapper matching Task 2's format (`rgb(var(--x) / <alpha-value>)` for RGB channels, or `hsl(var(--x) / <alpha-value>)` if you converted):

```js
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
```

- [ ] **Step 2: Verify.** Temporarily set a view to `className="bg-forest"` on the splash, run `npm run ios`, confirm dark-green renders; toggle appearance and confirm tokens flip. Remove the temp class.

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/tailwind.config.js
git commit -m "feat(mobile): map brand tokens + radii into Tailwind theme"
```

### Task 4: `cn()` util + alias resolution parity

**Files:**
- Verify/Modify: `apps/mobile/lib/utils.ts` (created by CLI in Task 1; ensure it exports `cn`)
- Verify: `apps/mobile/tsconfig.json` (alias already present), `apps/mobile/package.json` (jest `moduleNameMapper` from Task 1)

**Interfaces:**
- Produces: `cn(...classes)` at `@/lib/utils` (clsx + tailwind-merge). Consumed by brand wrappers (Task 8+).

- [ ] **Step 1: Ensure `lib/utils.ts` is:**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Write a failing alias test.** Create `__tests__/alias-smoke.test.ts`:

```ts
import { cn } from "@/lib/utils";
test("@/ alias + cn merge works in jest", () => {
  expect(cn("p-2", "p-4")).toBe("p-4");
});
```

- [ ] **Step 3: Run it.**

Run: `npx jest __tests__/alias-smoke.test.ts -v`
Expected: PASS (proves `moduleNameMapper` resolves `@/` under jest and `cn` merges).

- [ ] **Step 4: Commit.**

```bash
git add apps/mobile/lib/utils.ts apps/mobile/__tests__/alias-smoke.test.ts
git commit -m "chore(mobile): cn() util + @/ alias jest parity"
```

### Task 5: Root layout — color scheme, NAV_THEME, PortalHost

**Files:**
- Create: `apps/mobile/lib/nav-theme.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `global.css` import, RNR `PortalHost`.
- Produces: app-wide dark/light theming for React Navigation + a mounted `<PortalHost />` (required by `select`/`dialog`/`popover`/`dropdown-menu`/`tooltip`).

- [ ] **Step 1: Create `lib/nav-theme.ts`** (React Navigation theme mirroring the brand):

```ts
import type { Theme } from "@react-navigation/native";
export const NAV_LIGHT: Theme = {
  dark: false,
  colors: { primary: "#159A55", background: "#FFFFFF", card: "#FFFFFF", text: "#1D1D1F", border: "#E0E0E0", notification: "#FF3B30" },
  fonts: undefined as unknown as Theme["fonts"],
};
export const NAV_DARK: Theme = {
  dark: true,
  colors: { primary: "#2FB56A", background: "#0B0F0D", card: "#141916", text: "#F5F5F7", border: "#262B28", notification: "#FF453A" },
  fonts: undefined as unknown as Theme["fonts"],
};
```

> Note: on Expo SDK 57 use whichever `fonts` shape `@react-navigation/native` requires; copy the default from `DefaultTheme.fonts`/`DarkTheme.fonts` rather than the `undefined` cast if the navigator errors.

- [ ] **Step 2: Rewrite `app/_layout.tsx`** — import `global.css`, drive scheme with `useColorScheme`, wrap in `ThemeProvider`, mount `PortalHost`:

```tsx
import "../global.css";
import { Stack } from "expo-router";
import { ThemeProvider } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useColorScheme } from "nativewind";
import { PortalHost } from "@rn-primitives/portal";
import { AuthProvider } from "../lib/auth";
import { NAV_LIGHT, NAV_DARK } from "../lib/nav-theme";

const queryClient = new QueryClient();

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider value={dark ? NAV_DARK : NAV_LIGHT}>
          <AuthProvider>
            <StatusBar style={dark ? "light" : "dark"} />
            <Stack screenOptions={{ headerShown: false }} />
            <PortalHost />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
```

> `PortalHost` import path: use whatever RNR's added components import (it may re-export from `@/components/ui/*`); confirm the exact specifier from an added primitive that uses portals (e.g. open `components/ui/select.tsx` after Task 7 and match its `PortalHost`/`Portal` import). If `@rn-primitives/portal` isn't the installed package, use the one RNR pulled in.

- [ ] **Step 3: Verify tests.**

Run: `npm test`
Expected: PASS (49). If `nativewind`'s `useColorScheme` or `PortalHost` isn't resolvable under jest, add a `jest.mock` in `jest.setup.ts` returning `{ colorScheme: "light", setColorScheme(){} }` / a passthrough `PortalHost`.

- [ ] **Step 4: Verify iOS light + dark.** Launch, screenshot; toggle appearance; confirm background/text flip and no crash.

- [ ] **Step 5: Commit.**

```bash
git add apps/mobile/lib/nav-theme.ts apps/mobile/app/_layout.tsx apps/mobile/jest.setup.ts
git commit -m "feat(mobile): app-wide light/dark theming + PortalHost"
```

### Task 6: `text` + `icon` primitives and Lucide

**Files:**
- Create (CLI): `apps/mobile/components/ui/text.tsx`, `apps/mobile/components/ui/icon.tsx`

**Interfaces:**
- Produces: `Text` at `@/components/ui/text` (className-styled, theme-aware) and `Icon` at `@/components/ui/icon` (`<Icon as={LucideIcon} />`). Consumed by every migrated component/screen.

- [ ] **Step 1: Add via CLI:**

```bash
npx @react-native-reusables/cli@latest add text icon
```

- [ ] **Step 2: Smoke test.** Create `__tests__/ui-text.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Text } from "@/components/ui/text";
test("ui Text renders children", () => {
  render(<Text>hello</Text>);
  expect(screen.getByText("hello")).toBeOnTheScreen();
});
```

- [ ] **Step 3: Run.** `npx jest __tests__/ui-text.test.tsx -v` → Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/mobile/components/ui apps/mobile/__tests__/ui-text.test.tsx
git commit -m "feat(mobile): RNR Text + Icon (Lucide) primitives"
```

---

## Phase 2 — Primitives + brand wrappers

### Task 7: Add the RNR primitive set

**Files:**
- Create (CLI): `components/ui/{input,textarea,label,card,badge,avatar,select,checkbox,switch,toggle-group,toggle,separator,dialog,skeleton,progress}.tsx`

**Interfaces:**
- Produces: the RNR primitives the components/screens consume. Note exact export names + props by reading each generated file (e.g. `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`).

- [ ] **Step 1: Add them:**

```bash
npx @react-native-reusables/cli@latest add input textarea label card badge avatar select checkbox switch toggle-group toggle separator dialog skeleton progress
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → Expected: clean (RNR components are TS-strict compatible). Fix any peer-dep import the CLI flagged.

- [ ] **Step 3: Full suite.** `npm test` → Expected: PASS (49) — adding files shouldn't affect tests.

- [ ] **Step 4: Commit.**

```bash
git add apps/mobile/components/ui apps/mobile/package.json
git commit -m "feat(mobile): add RNR primitive set (input/card/badge/select/…)"
```

### Task 8: Brand-tune Button (pill) + Badge (status variants)

**Files:**
- Modify: `components/ui/button.tsx`, `components/ui/badge.tsx`
- Test: `__tests__/ui-button-badge.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 4), tokens (Task 3).
- Produces: `Button` defaulting to the brand pill; `badgeVariants` including `open|almost_full|closed|completed|cancelled|rescheduled|paid` mapped to brand tints. Consumed by StatusBadge (Task 9) and CTAs across Phase 4.

- [ ] **Step 1: Write failing tests.** Create `__tests__/ui-button-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";

test("Button renders label", () => {
  render(<Button><Text>Go</Text></Button>);
  expect(screen.getByText("Go")).toBeOnTheScreen();
});
test("Badge renders label", () => {
  render(<Badge><Text>Open</Text></Badge>);
  expect(screen.getByText("Open")).toBeOnTheScreen();
});
```

- [ ] **Step 2: Run → expect PASS** (`npx jest __tests__/ui-button-badge.test.tsx -v`). These guard that our edits keep the components renderable (visual pill/color is verified in the simulator, not asserted in jest).

- [ ] **Step 3: Edit `button.tsx`.** In the default variant's classes, set the pill radius and brand color: default `bg-primary` + `rounded-full`; text `text-primary-foreground`; pressed `active:bg-primary-focus`. Keep the existing `variant`/`size` API and `buttonVariants`/`buttonTextVariants` exports (Phase 4 uses `outline`/`ghost`/`link`).

- [ ] **Step 4: Extend `badge.tsx`** `badgeVariants` with the status variants (map to the table): `open` → `bg-muted` + `text-foreground`; `almost_full` → `bg-amber-tint text-amber`; `closed`/`completed` → `bg-muted text-muted-foreground`; `cancelled` → `bg-destructive-tint text-destructive`; `rescheduled` → `bg-info-tint text-info`; `paid` → `bg-paid-tint text-paid`. All `rounded-full`.

- [ ] **Step 5: Run tests + typecheck.** `npx jest __tests__/ui-button-badge.test.tsx -v` and `npx tsc --noEmit` → PASS/clean.

- [ ] **Step 6: Commit.**

```bash
git add apps/mobile/components/ui/button.tsx apps/mobile/components/ui/badge.tsx apps/mobile/__tests__/ui-button-badge.test.tsx
git commit -m "feat(mobile): brand pill Button + status Badge variants"
```

---

## Phase 3 — Leaf components (restyle; existing tests stay green)

> Pattern for every task in this phase: (1) run the component's existing test → confirm PASS; (2) replace `StyleSheet`/`theme.*` with RNR primitives + classes per the token map, **preserving all text / `testID` / `accessibilityRole` / `accessibilityLabel`**; (3) run the test → PASS; (4) simulator check light + dark; (5) commit. Remove the `theme` import when the file no longer needs it.

### Task 9: `StatusBadge` → `badge`

**Files:** Modify `components/StatusBadge.tsx` · Test `__tests__/event-card.test.tsx` (renders StatusBadge) + any status test.

- [ ] **Step 1:** Run `npx jest __tests__/event-card.test.tsx -v` → PASS (baseline).
- [ ] **Step 2:** Keep `eventStatusKind`/`eventStatusLabel` exports **unchanged**. Replace the `View`+`Text` in `StatusBadge` with `<Badge variant={eventStatusKind(event)}>` from `@/components/ui/badge` (drop the local `TINT` map — variants now carry color). Rebuild `StatusBanner` with `View className="px-[18px] py-[13px] bg-destructive-tint"` (or `bg-info-tint`), `Icon` for `⊘`/`↻`, text via `@/components/ui/text`. Preserve the banner's rendered strings verbatim (both tests and users read them).
- [ ] **Step 3:** Run `npx jest __tests__/event-card.test.tsx -v` → PASS.
- [ ] **Step 4:** Simulator: a card list in light + dark — badges show correct tints.
- [ ] **Step 5:** Commit `feat(mobile): StatusBadge/Banner on RNR Badge`.

### Task 10: `OrgAvatar` → `avatar`

**Files:** Modify `components/OrgAvatar.tsx` · Test `__tests__/org-page.test.tsx`, `event-card.test.tsx`.

- [ ] **Step 1:** Run those two tests → PASS.
- [ ] **Step 2:** Rebuild on `@/components/ui/avatar` (`Avatar`/`AvatarImage`/`AvatarFallback`). Keep the `name`/`color`/`size` props and the initials fallback. Preserve any `testID`.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): OrgAvatar on RNR Avatar`.

### Task 11: `EventCard` → `card` + `text` + `badge` + `avatar`

**Files:** Modify `components/EventCard.tsx` · Test `__tests__/event-card.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/event-card.test.tsx -v` → PASS (note it asserts image `testID="event-card-image"` + fallback + text).
- [ ] **Step 2:** Wrap in `Card` (`className="rounded-[18px] border border-border overflow-hidden bg-card mb-4"`). Image/`ElevationHero` block unchanged (keep `testID="event-card-image"` and the `onError` fallback). Body text → `@/components/ui/text` with `text-[17px] font-semibold` (name), `text-sm text-muted-foreground` (meta). Org row border `border-t border-divider`. StatusBadge + OrgAvatar already migrated.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): EventCard on RNR Card`.

### Task 12: `PillSelect` → `toggle-group`

**Files:** Modify `components/PillSelect.tsx` · Test `__tests__/pill-select.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/pill-select.test.tsx -v` → PASS (asserts `accessibilityState.selected`, `accessibilityLabel` per option, `onChange`).
- [ ] **Step 2:** Rebuild with `ToggleGroup type="single"` + `ToggleGroupItem value={opt}`. **Preserve the public prop API** (`label,value,options,onChange,accessibilityLabel`) and per-item `accessibilityLabel={opt}` + selected state. Active item `bg-primary` + `text-primary-foreground`, inactive `border border-border`, all `rounded-full`. Label `text-[11px] font-semibold tracking-[0.4px] text-muted-foreground`.
- [ ] **Step 3:** Tests → PASS (if a test asserts on `style`, refactor it to assert `accessibilityState.selected`). **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): PillSelect on RNR ToggleGroup`.

### Task 13: `PsgcAddressPicker` → `select` ×3

**Files:** Modify `components/PsgcAddressPicker.tsx` · Test `__tests__/psgc-picker.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/psgc-picker.test.tsx -v` → PASS (baseline; note how it drives selection + the region/province/city cascade + NCR "no province" case).
- [ ] **Step 2:** Replace each cascading control with `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from `@/components/ui/select`. **Preserve** the cascade logic, loading states, the NCR-has-no-province branch, and every `accessibilityLabel`/`testID` the test queries. `Select` uses portals — ensure Task 5's `PortalHost` is mounted (it is).
- [ ] **Step 3:** Tests → PASS. If RNR `Select`'s portal breaks the test's query, add `jest.setup` mock or query via the trigger's label; keep behavior identical. **Step 4:** Simulator light/dark (open a dropdown in each). **Step 5:** Commit `feat(mobile): PSGC picker on RNR Select`.

### Task 14: `DynamicField` → RNR inputs (behavior preserved)

**Files:** Modify `components/DynamicField.tsx` · Test `__tests__/dynamic-field.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/dynamic-field.test.tsx -v` → PASS.
- [ ] **Step 2:** Map by `field.type`: `text`/`date` → `Input` (**keep** `date`'s `YYYY-MM-DD` placeholder + text behavior — no picker); `number` → `Input keyboardType="numeric"` with the same `onChange` numeric coercion; `checkbox` → `Switch` (unchanged behavior); `select` → `ToggleGroup` (reuse the Task 12 look) or inline `Select`; `file` → **keep** the "File uploads aren't supported yet." `Text` stub. `Label` via `@/components/ui/label`; preserve `field.label`, the ` *` required suffix, and each `accessibilityLabel={field.label}`.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark (one of each type). **Step 5:** Commit `feat(mobile): DynamicField on RNR inputs (behavior preserved)`.

### Task 15: `BrandHeader`, `OrgHeader`, `OrgBanner` restyle

**Files:** Modify `components/BrandHeader.tsx`, `components/OrgHeader.tsx`, `components/OrgBanner.tsx` · Test `__tests__/org-page.test.tsx` (OrgHeader/Banner).

- [ ] **Step 1:** Run `npx jest __tests__/org-page.test.tsx -v` → PASS.
- [ ] **Step 2:** Convert each to `View`/`Text` classes per the map. `BrandHeader`: brand mark + name + notification bell → replace the emoji bell with `<Icon as={Bell} />` (`lucide-react-native`); keep any `accessibilityLabel`. `OrgBanner`/`OrgHeader`: `bg-forest` banner surfaces, `text-primary-foreground`/`text-foreground` as appropriate. Preserve rendered org name/text.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): brand/org headers on NativeWind + Lucide`.

### Task 16: `ElevationHero`, `EventGallery` restyle

**Files:** Modify `components/ElevationHero.tsx`, `components/EventGallery.tsx` · Test `__tests__/event-gallery.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/event-gallery.test.tsx -v` → PASS (note gallery paging/dots + `testID`s).
- [ ] **Step 2:** `ElevationHero`: keep the SVG/visual (it uses `react-native-svg`); convert its container `View` styling to classes; ensure colors read from tokens (a subtle brand-tinted placeholder — `bg-secondary`/`bg-muted`). `EventGallery`: keep the `FlatList`/paging **logic and `testID`s**; restyle dots/frame with classes (`aspect-*` for framing). No behavior change.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark (swipe the gallery). **Step 5:** Commit `feat(mobile): hero + gallery on NativeWind`.

### Task 17: `TicketQR` → `card` wrapper

**Files:** Modify `components/TicketQR.tsx` · Test `__tests__/ticket-screen.test.tsx` (renders TicketQR).

- [ ] **Step 1:** Run `npx jest __tests__/ticket-screen.test.tsx -v` → PASS.
- [ ] **Step 2:** **Keep `react-native-qrcode-svg`** and the token string it renders. Wrap the QR in `Card` on a light surface (QR must stay dark-on-light for scannability **even in dark mode** — hard-code the QR tile `bg-white` regardless of scheme; only the surrounding chrome follows the theme). Preserve any `testID`.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark — confirm the QR stays scannable (white tile) in dark mode. **Step 5:** Commit `feat(mobile): TicketQR in RNR Card (scannable in dark)`.

### Task 18 (OPTIONAL): Real date + file controls

> Only do this if we decide to upgrade `DynamicField` beyond the current text/stub behavior. It is **feature work**, not part of the restyle, and is safe to skip or defer. If skipped, delete this task.

**Files:** Create `components/fields/DateField.tsx`, `components/fields/FileField.tsx` · Modify `components/DynamicField.tsx` · Test `__tests__/date-file-field.test.tsx`.

- [ ] **Step 1: Install deps.** `npx expo install @react-native-community/datetimepicker expo-document-picker`
- [ ] **Step 2: Write failing tests** for `DateField` (produces `YYYY-MM-DD` string via `onChange`) and `FileField` (picks a doc, uploads to Supabase Storage via existing `lib`, stores the path). Full assertions, mocking the picker + storage client.
- [ ] **Step 3:** Run → FAIL (components not defined).
- [ ] **Step 4:** Implement both controls (styled like `Input`), wire into `DynamicField`'s `date`/`file` branches behind the same `onChange` contract.
- [ ] **Step 5:** Run tests → PASS; then full `npm test` → PASS.
- [ ] **Step 6:** Commit `feat(mobile): real date + file registration fields`.

---

## Phase 4 — Screens (restyle; existing tests stay green)

> Same restyle pattern as Phase 3. Screens have no `StyleSheet` left after this phase; all colors are semantic classes (dark-ready). Verify each screen's four states (loading/empty/error/offline) where present, in light **and** dark.

### Task 19: Auth layout + `sign-in`

**Files:** Modify `app/(auth)/_layout.tsx`, `app/(auth)/sign-in.tsx` · Test `__tests__/sign-in.test.tsx`, `auth.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/sign-in.test.tsx __tests__/auth.test.tsx -v` → PASS.
- [ ] **Step 2:** Optionally pull RNR's block for structure: `npx @react-native-reusables/cli@latest add sign-in-form` (into `components/ui/` or a `blocks/` dir), then adapt its **UI** — do **not** import Clerk; keep the existing Supabase calls from `lib/auth`. Rebuild the screen with `Input`/`Label`/`Button`/`Text`, the brand logo over the existing `expo-video` background (unchanged; jest already mocks `expo-video`). Preserve every `accessibilityLabel`/`testID`/error string the test asserts.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator: sign-in light/dark, error state. **Step 5:** Commit `feat(mobile): sign-in on RNR (Supabase-wired)`.

### Task 20: `sign-up` (+ verify)

**Files:** Modify `app/(auth)/sign-up.tsx` · Test `__tests__/auth.test.tsx` (sign-up paths, if present).

- [ ] **Step 1:** Run the auth test → PASS.
- [ ] **Step 2:** Adapt RNR `sign-up-form` (+ `verify-email-form` if the screen has a verify step) UI; keep Supabase sign-up + the email-verification gate behavior. `Input`/`Label`/`Button`/`Text`; preserve labels/testIDs/copy.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): sign-up on RNR (Supabase-wired)`.

### Task 21: Tabs layout

**Files:** Modify `app/(tabs)/_layout.tsx`.

- [ ] **Step 1:** Full suite baseline `npm test` → PASS.
- [ ] **Step 2:** Keep `Tabs` + `BrandHeader` header. Replace the hard-coded `tabBarActiveTintColor: theme.primary` with the NAV_THEME primary (it now flows from `ThemeProvider`), or read the token; give each tab a Lucide icon via `tabBarIcon` (`Compass`/`Building2`/`Ticket`/`User`). Set `tabBarStyle`/label colors from the theme so the bar is correct in dark.
- [ ] **Step 3:** `npm test` → PASS. **Step 4:** Simulator light/dark — tab bar + icons legible in both. **Step 5:** Commit `feat(mobile): themed tab bar with Lucide icons`.

### Task 22: `events` screen

**Files:** Modify `app/(tabs)/events.tsx` · Test `__tests__/marketplace-search.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/marketplace-search.test.tsx -v` → PASS (asserts search filtering + `accessibilityLabel="Search events"`).
- [ ] **Step 2:** Convert `styles` to classes: list `bg-background`; header title `text-2xl font-bold tracking-[-0.4px] text-foreground`; search row `flex-row items-center gap-2 bg-muted rounded-[11px] py-3 px-[14px]` with `Icon as={Search}` replacing `⌕`; `Input` for the field (**keep** `accessibilityLabel="Search events"`, `value`, `onChangeText`). Empty/error states via `Text`/`Button`. `EventCard` already migrated.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark: list, empty (`q` with no match), error (force `refetch` fail). **Step 5:** Commit `feat(mobile): events screen on NativeWind`.

### Task 23: `orgs` screen

**Files:** Modify `app/(tabs)/orgs.tsx` · Test `__tests__/orgs.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/orgs.test.tsx -v` → PASS.
- [ ] **Step 2:** Convert to classes; org rows use migrated `OrgAvatar`; preserve list text + `accessibilityLabel`s + navigation. Loading/empty/error via `Text`/`Button`.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): orgs screen on NativeWind`.

### Task 24: `races` (My Races) screen

**Files:** Modify `app/(tabs)/races.tsx` · Test `__tests__/my-races.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/my-races.test.tsx -v` → PASS.
- [ ] **Step 2:** Convert to classes; registration rows → `Card`; status via migrated `StatusBadge`/`Badge`; preserve the offline/cached rendering behavior and all text/labels. Do **not** change any ticket-cache logic.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): My Races on NativeWind`.

### Task 25: `profile` screen

**Files:** Modify `app/(tabs)/profile.tsx` · Test `__tests__/profile.test.tsx`, `psgc-picker.test.tsx` (embedded city picker).

- [ ] **Step 1:** Run `npx jest __tests__/profile.test.tsx -v` → PASS (asserts passport prefill/save + PSGC city).
- [ ] **Step 2:** Convert to classes: `Input`/`Label` for passport fields, migrated `PillSelect`/`PsgcAddressPicker`, `Button` for Save / Switch org / Sign out. **Preserve** every field `accessibilityLabel`, the save behavior, and validation copy.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark; save round-trip. **Step 5:** Commit `feat(mobile): profile screen on RNR inputs`.

### Task 26: `event/[id]` detail

**Files:** Modify `app/event/[id].tsx` · Test `__tests__/event-address.test.tsx`, `event-gallery.test.tsx`.

- [ ] **Step 1:** Run those tests → PASS.
- [ ] **Step 2:** Convert to classes: hero (`ElevationHero`/`EventGallery` migrated), `StatusBanner`, category list rows → `Card`/`Button` (price + remaining slots), address block. Preserve `formatAddress` output, category-select navigation, and all labels.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): event detail on NativeWind`.

### Task 27: `org/[id]` page

**Files:** Modify `app/org/[id].tsx` · Test `__tests__/org-page.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/org-page.test.tsx -v` → PASS.
- [ ] **Step 2:** Convert to classes; migrated `OrgHeader`/`OrgBanner`/`EventCard`; preserve text + navigation.
- [ ] **Step 3:** Tests → PASS. **Step 4:** Simulator light/dark. **Step 5:** Commit `feat(mobile): org page on NativeWind`.

### Task 28: `index` splash

**Files:** Modify `app/index.tsx`.

- [ ] **Step 1:** `npm test` baseline → PASS.
- [ ] **Step 2:** Convert the session-restore splash to classes (`bg-background`, centered brand mark, `ActivityIndicator` tinted from token). Keep the redirect logic.
- [ ] **Step 3:** `npm test` → PASS. **Step 4:** Simulator light/dark cold start. **Step 5:** Commit `feat(mobile): splash on NativeWind`.

### Task 29: `register` (money path — careful)

**Files:** Modify `app/register/[categoryId].tsx` · Test `__tests__/register-submit.test.tsx`, `register-checkout.test.ts`, `register-saveback.test.tsx`.

- [ ] **Step 1:** Run all three → PASS (baseline). These assert bib/emergency/waiver validation, save-back gating, and `startCheckout` payload — **behavior must not change**.
- [ ] **Step 2:** Convert `styles` → classes. Map the custom track/knob toggles (`firstUltra`, addon rows, save-back, waiver) to RNR `Switch` **without changing** their `accessibilityRole`/`accessibilityState`/`accessibilityLabel` or the state they drive. Fields → `Input` + `Label` (keep `EMERGENCY CONTACT · required` red-label behavior and the `inputErr` red-border on validation). Migrated `PillSelect`/`DynamicField`. Sticky footer CTA → `Button` (keep `Submitting…`/`Register` text + `disabled`/`busy`). **Do not touch** `submit()`, prefill, or the checkout payload.
- [ ] **Step 3:** Run all three tests → PASS. Then `npm test` (full) → PASS.
- [ ] **Step 4:** Simulator light/dark: full form, trigger a validation error, confirm the toggles + CTA behave.
- [ ] **Step 5:** Commit `feat(mobile): register screen on RNR (behavior unchanged)`.

### Task 30: `pay` (money path — careful)

**Files:** Modify `app/pay/[registrationId].tsx` · Test `__tests__/pay-screen.test.tsx`.

- [ ] **Step 1:** Run `npx jest __tests__/pay-screen.test.tsx -v` → PASS (asserts the WebView/redirect + Pending handling).
- [ ] **Step 2:** Restyle chrome only — **keep** the `expo-web-browser`/WebView flow, the deep-link return handling, the realtime+poll Pending→Confirmed logic, and all status copy. Status chips via migrated `Badge`; buttons via `Button`. No flow change.
- [ ] **Step 3:** Tests → PASS; `npm test` → PASS. **Step 4:** Simulator light/dark: Pending + Failed + Retry states. **Step 5:** Commit `feat(mobile): pay screen on RNR (flow unchanged)`.

### Task 31: `ticket` (money path — careful)

**Files:** Modify `app/ticket/[registrationId].tsx` · Test `__tests__/ticket-screen.test.tsx`, `ticket-cache.test.ts`.

- [ ] **Step 1:** Run both → PASS (asserts offline cache render + QR).
- [ ] **Step 2:** Restyle: `bg-forest` pass surface, migrated `TicketQR` (white tile), runner/event info via `Text`. **Keep** the MMKV/offline cache reads and the signed-token rendering untouched. The QR tile stays `bg-white` in dark mode (Task 17).
- [ ] **Step 3:** Tests → PASS; `npm test` → PASS. **Step 4:** Simulator light/dark + airplane-mode offline render. **Step 5:** Commit `feat(mobile): ticket screen on RNR (offline unchanged)`.

---

## Phase 5 — Cleanup & verification

### Task 32: Delete the `theme.ts` bridge

**Files:** Delete `apps/mobile/lib/theme.ts` · touch any stragglers.

- [ ] **Step 1:** Find remaining importers: `grep -rn "lib/theme" apps/mobile/app apps/mobile/components` (expect **none** after Phase 3–4; if any remain, migrate them now per the token map).
- [ ] **Step 2:** Delete `lib/theme.ts`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean; `npm test` → PASS (49).
- [ ] **Step 4:** Commit `chore(mobile): remove legacy theme.ts bridge`.

### Task 33: Regenerate `DESIGN.md`

**Files:** Modify `apps/mobile/DESIGN.md`.

- [ ] **Step 1:** Rewrite the `colors:` block + prose so **primary = trail-green `#159A55`** (not Action Blue `#0066cc`); keep `#0066cc` only as the `info`/rescheduled status. Add the **dark palette** (spec §6) as a documented section. Note the app now uses NativeWind semantic tokens (`global.css` is the source of truth; `DESIGN.md` documents them).
- [ ] **Step 2:** Commit `docs(mobile): DESIGN.md → real trail-green palette + dark spec`.

### Task 34: Final verification (iOS + Android)

- [ ] **Step 1:** `npm test` → PASS (49); `npx tsc --noEmit` → clean.
- [ ] **Step 2:** iOS simulator: walk auth → events → event → register → pay (sandbox) → ticket, in light **and** dark. Screenshot the ticket (offline) in both.
- [ ] **Step 3:** Android: `npm run android` — smoke the same happy path once; confirm no NativeWind/portal issues and dark mode works. Note any Android-only fixes as follow-up tasks (don't block on polish).
- [ ] **Step 4:** Update `docs/README.md` roadmap with a "Mobile UI → RNR migration" entry linking this plan + the spec.
- [ ] **Step 5:** Commit `docs: record mobile RNR migration in roadmap`.

---

## Self-review notes

- **Spec coverage:** foundation (§5)→T1–6; theming light+dark (§6)→T2–3,5; component mapping (§7)→T9–17; date/file gap (§7.1)→T14 (preserve) + T18 (optional real); auth blocks (§8)→T19–20; screen order money-last (§9)→T21–31; testing/risk (§10)→per-task guard + T34; cleanup (§11)→T32–33. All covered.
- **Money path last:** register/pay/ticket are T29–31, after every dependency (Badge, Switch, Input, DynamicField, TicketQR) is migrated.
- **No behavior change:** every restyle task runs the file's existing test before and after; `theme.ts` bridge keeps un-migrated code compiling until T32.
- **Known unknowns deferred to the spike (T1):** exact NativeWind/Tailwind versions, `global.css` channel format (RGB vs HSL — T2/T3 must agree), `PortalHost` import specifier, and any jest mock NativeWind needs. All have explicit resolution steps.
