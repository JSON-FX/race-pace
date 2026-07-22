// Jest (jest-expo's babel transform) has no CSS loader -- unlike Metro, which
// NativeWind's plugin processes at bundle time. Any side-effect `import
// "*.css"` (e.g. app/_layout.tsx's `import "../global.css"`) needs a stub so
// Jest doesn't try to parse Tailwind directives as JavaScript. See the
// "\\.css$" entry in package.json's jest.moduleNameMapper.
module.exports = {};
