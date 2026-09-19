/** Fixed public asset avoids allowing organizer content to control email branding. */
export const EMAIL_LOGO_URL = "https://www.racepace.com.ph/topnav-logo.png";
export const STAGING_EMAIL_LOGO_URL = "https://pepbmqomiailnnvvwupz.supabase.co/storage/v1/object/public/email-branding/topnav-logo.png";

export function isStagingEmail(): boolean {
  return typeof Deno !== "undefined" && Deno.env.get("EMAIL_ENVIRONMENT") === "staging";
}

export function emailBrandHeader(stagingNotice = "TEST — STAGING · This is not a real booking"): string {
  const logoUrl = isStagingEmail() ? STAGING_EMAIL_LOGO_URL : EMAIL_LOGO_URL;
  return `${isStagingEmail() ? `<tr><td style="background:#fff0ce;color:#6b4913;text-align:center;padding:10px;font:12px Arial,sans-serif;font-weight:bold">${stagingNotice}</td></tr>` : ''}
<tr><td style="padding:26px 28px;background:#ffffff;border-bottom:1px solid #e4ebe6"><img src="${logoUrl}" width="86" alt="" role="presentation" style="display:inline-block;border:0;vertical-align:middle" /><span style="font:700 21px Arial,sans-serif;color:#183b2a;vertical-align:middle">&nbsp; Race Pace</span></td></tr>`;
}

export function emailBrandFooter(): string {
  return '<tr><td style="padding:22px 28px;background:#ffffff;border-top:1px solid #e4ebe6;font:12px/1.8 Arial,sans-serif;color:#657469">Race Pace · Your next starting line.<br>Need help? <a href="mailto:support.racepace@gmail.com" style="color:#148b4d">Contact Race Pace support</a>.</td></tr>';
}
