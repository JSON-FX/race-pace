// React Navigation theme mirroring the brand (trail-green), consumed by the
// root layout's ThemeProvider.
//
// NOTE: Expo SDK 57's expo-router (57.0.7) no longer depends on the
// `@react-navigation/native` package -- it vendors its own fork internally
// and re-exports `ThemeProvider` / `DefaultTheme` / `DarkTheme` / `Theme`
// directly from `expo-router` (see node_modules/expo-router/build/exports.d.ts).
// `@react-navigation/native` is not present anywhere in this repo's
// dependency tree, so importing from it would fail to resolve. We import the
// theme primitives from `expo-router` instead and spread its `DefaultTheme`
// / `DarkTheme` as a base so `fonts` always matches the shape the vendored
// navigator expects (platform-correct font family/weight), overriding only
// `dark` and `colors` with the brand palette.
import { DarkTheme, DefaultTheme, type Theme } from "expo-router";

export const NAV_LIGHT: Theme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: "#159A55",
    background: "#FFFFFF",
    card: "#FFFFFF",
    text: "#1D1D1F",
    border: "#E0E0E0",
    notification: "#FF3B30",
  },
};

export const NAV_DARK: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: "#2FB56A",
    background: "#0B0F0D",
    card: "#141916",
    text: "#F5F5F7",
    border: "#262B28",
    notification: "#FF453A",
  },
};
