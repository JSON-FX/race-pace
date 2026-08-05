// Next.js's bundled global types (node_modules/next/types/global.d.ts) only
// declare `*.module.css`, not plain `*.css`. apps/web gets a generic
// `declare module "*.css"` for free from Vite's `vite/client` types; this
// app has no such dependency, so `import "./globals.css"` in app/layout.tsx
// fails tsc with TS2882 ("Cannot find module or type declarations for
// side-effect import") without this declaration.
declare module "*.css";
