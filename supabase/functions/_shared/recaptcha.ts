const ASSESSMENTS_BASE = "https://recaptchaenterprise.googleapis.com/v1/projects";

type AssessmentResponse = {
  tokenProperties?: {
    valid?: boolean;
    hostname?: string;
    action?: string;
  };
  riskAnalysis?: { score?: number };
};

export type RecaptchaConfig = {
  projectId: string;
  apiKey: string;
  siteKey: string;
  allowedHostnames: string[];
  minimumScore: number;
};

export type RecaptchaDecision =
  | { ok: true }
  | { ok: false; reason: "configuration" | "invalid" | "action" | "hostname" | "score" | "provider" };

export function recaptchaConfigFromEnv(getEnv: (key: string) => string | undefined): RecaptchaConfig | null {
  const projectId = getEnv("GOOGLE_CLOUD_PROJECT_ID")?.trim() ?? "";
  const apiKey = getEnv("RECAPTCHA_ENTERPRISE_API_KEY")?.trim() ?? "";
  const siteKey = getEnv("RECAPTCHA_ENTERPRISE_SITE_KEY")?.trim() ?? "";
  const allowedHostnames = (getEnv("RECAPTCHA_ALLOWED_HOSTNAMES") ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  const configuredScore = Number(getEnv("RECAPTCHA_MIN_SCORE") ?? "0.7");

  if (!projectId || !apiKey || !siteKey || allowedHostnames.length === 0) return null;
  if (!Number.isFinite(configuredScore) || configuredScore < 0 || configuredScore > 1) return null;

  return { projectId, apiKey, siteKey, allowedHostnames, minimumScore: configuredScore };
}

export async function verifyRecaptchaEnterprise(
  token: unknown,
  expectedAction: string,
  config: RecaptchaConfig | null,
  fetcher: typeof fetch = fetch,
): Promise<RecaptchaDecision> {
  if (!config) return { ok: false, reason: "configuration" };
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const endpoint = `${ASSESSMENTS_BASE}/${encodeURIComponent(config.projectId)}/assessments?key=${encodeURIComponent(config.apiKey)}`;
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: { token, siteKey: config.siteKey } }),
    });
    if (!response.ok) return { ok: false, reason: "provider" };

    const assessment = await response.json() as AssessmentResponse;
    if (!assessment.tokenProperties?.valid) return { ok: false, reason: "invalid" };
    if (assessment.tokenProperties.action !== expectedAction) return { ok: false, reason: "action" };
    const hostname = assessment.tokenProperties.hostname?.toLowerCase() ?? "";
    if (!config.allowedHostnames.includes(hostname)) return { ok: false, reason: "hostname" };
    if (typeof assessment.riskAnalysis?.score !== "number" || assessment.riskAnalysis.score < config.minimumScore) {
      return { ok: false, reason: "score" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "provider" };
  }
}
