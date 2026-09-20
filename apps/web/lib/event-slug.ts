export const EVENT_SLUG_MAX_LENGTH = 80;

/** Stable public event addresses use lowercase ASCII kebab-case. */
export function normalizeEventSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, EVENT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidEventSlug(slug: string): boolean {
  return slug.length <= EVENT_SLUG_MAX_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function eventPublicPath(event: { id: string; slug?: string | null }): string {
  return `/events/${event.slug || event.id}`;
}

export function eventPublicUrl(slug: string, siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"): string {
  return new URL(`/events/${slug}`, `${siteUrl.replace(/\/+$/, "")}/`).toString();
}
