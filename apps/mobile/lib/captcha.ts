import * as WebBrowser from "expo-web-browser";

const CALLBACK_URL = "racepace://captcha";

export function parseCaptchaCallback(url: string): string {
  const callback = new URL(url);
  if (callback.protocol !== "racepace:" || callback.hostname !== "captcha" || (callback.pathname !== "" && callback.pathname !== "/")) {
    throw new Error("captcha_callback_invalid");
  }

  const tokens = callback.searchParams.getAll("token");
  if (tokens.length !== 1 || tokens[0].length < 20 || tokens[0].length > 4096) {
    throw new Error("captcha_token_invalid");
  }
  return tokens[0];
}

export async function getAuthCaptchaToken(): Promise<string> {
  const siteUrl = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) throw new Error("captcha_not_configured");

  const result = await WebBrowser.openAuthSessionAsync(`${siteUrl}/auth/captcha`, CALLBACK_URL);
  if (result.type !== "success" || !("url" in result) || !result.url) {
    throw new Error("captcha_cancelled");
  }
  return parseCaptchaCallback(result.url);
}
