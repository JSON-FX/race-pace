// Next.js's bundled global types (node_modules/next/types/global.d.ts) only
// declare `*.module.css`, not plain `*.css`. This app used to get a generic
// `declare module "*.css"` for free from Vite's `vite/client` types; now that
// vite is gone, `import "./globals.css"` in app/layout.tsx fails tsc with
// TS2882 ("Cannot find module or type declarations for side-effect import")
// without this declaration. Mirrors apps/site/global.d.ts.
declare module "*.css";
