/// <reference types="nativewind/types" />

// `nativewind/types` only augments RN component props (className, etc.) --
// it doesn't declare the `*.css` module shape needed for the root layout's
// side-effect `import "../global.css"` (NativeWind's Metro plugin handles
// this at the bundler level; TypeScript needs its own ambient declaration).
declare module "*.css";
