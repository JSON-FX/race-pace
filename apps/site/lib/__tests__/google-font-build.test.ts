import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const base = "next/dist/compiled/@next/font/dist/google/";
type FontFile = { googleFontFileUrl: string; ext: string; preloadFontFile: boolean };
const parser: { findFontFilesInCss: (css: string, subsets?: string[]) => FontFile[] } = require(`${base}find-font-files-in-css`);
const cssFetcher: { fetchCSSFromGoogleFonts: (url: string, family: string, dev: boolean) => Promise<string> } = require(`${base}fetch-css-from-google-fonts`);
const fontFetcher: { fetchFontFile: (url: string, dev: boolean) => Promise<Buffer> } = require(`${base}fetch-font-file`);
type Loader = (input: {
  functionName: string;
  data: { subsets: string[]; weight: string[]; variable: string }[];
  isDev: boolean;
  isServer: boolean;
  emitFontFile: (buffer: Buffer, extension: string, preload: boolean, adjustFallback: boolean) => string;
}) => Promise<{ css: string; variable: string }>;

const extensionless = "https://fonts.gstatic.com/l/font?kit=a%2Bb%25c=d&skey=test&v=v24";
const css = (url: string, format = "woff2") => `/* latin */
@font-face {
  font-family: 'JetBrains Mono';
  src: url(${url})${format ? ` format('${format}')` : ""};
}`;

afterEach(() => vi.restoreAllMocks());

describe("Google font build compatibility", () => {
  it.each([
    ["https://fonts.gstatic.com/font.woff2", "truetype", "woff2"],
    ["https://fonts.gstatic.com/font.woff2?version=2#font", "truetype", "woff2"],
    [extensionless, "woff2", "woff2"],
    [extensionless, "woff", "woff"],
    [extensionless, "truetype", "ttf"],
    [extensionless, "opentype", "otf"],
    [extensionless, "embedded-opentype", "eot"],
    [extensionless, "", "woff2"],
  ])("resolves %s with format %s", (url, format, expected) => {
    expect(parser.findFontFilesInCss(css(url, format), ["latin"]))
      .toEqual([{ googleFontFileUrl: url, ext: expected, preloadFontFile: true }]);
  });

  it("retains URL deduplication and subset preloading", () => {
    const url = "https://fonts.gstatic.com/font.woff2";
    const styles = `${css(url)}\n${css(url)}\n/* cyrillic */\n  src: url(https://fonts.gstatic.com/other.woff2) format('woff2');`;
    expect(parser.findFontFilesInCss(styles, ["latin"]))
      .toEqual([{ googleFontFileUrl: url, ext: "woff2", preloadFontFile: true },
        { googleFontFileUrl: "https://fonts.gstatic.com/other.woff2", ext: "woff2", preloadFontFile: false }]);
  });

  it.each([extensionless, "https://fonts.gstatic.com/font.woff2?version=2#font"])("emits and rewrites %s in the actual production loader", async (url) => {
    // Each compiler's loader caches fetched CSS/fonts. Reset only this module so
    // every fixture exercises its own URL rather than the preceding test's cache.
    delete require.cache[require.resolve(`${base}loader`)];
    const load: Loader = require(`${base}loader`).default;
    const bytes = Buffer.from("wOF2");
    vi.spyOn(cssFetcher, "fetchCSSFromGoogleFonts").mockResolvedValue(css(url));
    vi.spyOn(fontFetcher, "fetchFontFile").mockResolvedValue(bytes);
    const emitFontFile = vi.fn(() => "/_next/static/media/test.woff2");
    const result = await load({
      functionName: "JetBrains_Mono",
      data: [{ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono-race" }],
      isDev: false,
      isServer: true,
      emitFontFile,
    });
    expect(emitFontFile).toHaveBeenCalledWith(bytes, "woff2", true, true);
    expect(result.variable).toBe("--font-mono-race");
    expect(result.css).toContain("url(/_next/static/media/test.woff2) format('woff2')");
    expect(result.css).not.toContain("fonts.gstatic.com");
  });
});
