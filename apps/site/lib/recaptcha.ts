type RecaptchaEnterpriseApi = {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: { enterprise?: RecaptchaEnterpriseApi };
  }
}

const SCRIPT_ID = "race-pace-recaptcha-enterprise";
const ORGANIZER_ACTION = "organizer_inquiry";
let scriptPromise: Promise<RecaptchaEnterpriseApi> | null = null;

function loadRecaptcha(siteKey: string): Promise<RecaptchaEnterpriseApi> {
  const current = window.grecaptcha?.enterprise;
  if (current) return Promise.resolve(current);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<RecaptchaEnterpriseApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const loaded = () => {
      const api = window.grecaptcha?.enterprise;
      if (api) resolve(api);
      else {
        script.remove();
        reject(new Error("recaptcha_unavailable"));
      }
    };
    const failed = () => {
      script.remove();
      reject(new Error("recaptcha_load_failed"));
    };

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

export async function getOrganizerInquiryCaptchaToken(): Promise<string> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) throw new Error("recaptcha_not_configured");

  const api = await loadRecaptcha(siteKey);
  return await new Promise((resolve, reject) => {
    api.ready(() => {
      api.execute(siteKey, { action: ORGANIZER_ACTION }).then(resolve, reject);
    });
  });
}
