import type { SupabaseClient } from "@supabase/supabase-js";
import { DISCIPLINE_LABELS, type EventDiscipline } from "@race-pace/shared";
import { isRegistrationClosed } from "./eventStatus";

export type OrganizerEvent = {
  id: string;
  name: string;
  slug: string | null;
  eventDate: string | null;
  imageUrl: string | null;
  place: string | null;
  distances: number[];
  discipline: string | null;
  slotsLeft: number | null;
  registrationClosed: boolean;
  comingSoon: boolean;
};

export type Organizer = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  featuredImageUrl: string | null;
  description: string | null;
  homeCity: string | null;
  homeProvince: string | null;
  homeRegion: string | null;
  homeBase: string | null;
  events: OrganizerEvent[];
  raceTypes: string[];
};

type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  banner_url: string | null;
  featured_image_url: string | null;
  description: string | null;
  home_city_name: string | null;
  home_province_name: string | null;
  home_region_name: string | null;
};

type EventRecord = {
  id: string;
  org_id: string;
  name: string;
  slug: string | null;
  event_date: string | null;
  hero_image_url: string | null;
  city_name: string | null;
  place: string | null;
  discipline: string | null;
  status: string;
  registration_closes_at: string | null;
  total_event_slots?: number | null;
  categories: { distance_km: number | string | null; slots_total: number; slots_taken: number }[] | null;
};

const ORGANIZATION_COLUMNS = "id,slug,name,logo_url,banner_url,featured_image_url,description,home_city_name,home_province_name,home_region_name";
const EVENT_COLUMNS = "id,org_id,name,slug,event_date,hero_image_url,city_name,place,discipline,status,registration_closes_at,total_event_slots,categories(distance_km,slots_total,slots_taken)";
const PAGE_SIZE = 500;
const PUBLIC_UPCOMING_STATUSES = ["coming_soon", "open", "almost_full", "closed"];

export function philippineToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function homeBaseOf(org: Pick<Organizer, "homeCity" | "homeProvince" | "homeRegion">): string | null {
  const parts = [org.homeCity, org.homeProvince || (!org.homeCity ? org.homeRegion : null)]
    .filter((part): part is string => !!part?.trim());
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

export function regionsOf(organizers: Organizer[]): string[] {
  return [...new Set(organizers.map((org) => org.homeRegion?.trim()).filter((region): region is string => !!region))]
    .sort((a, b) => a.localeCompare(b));
}

export function filterOrganizers(organizers: Organizer[], query: string, region: string): Organizer[] {
  const needle = query.trim().toLocaleLowerCase();
  return organizers.filter((org) => {
    if (region && org.homeRegion !== region) return false;
    if (!needle) return true;
    return [org.name, org.description, org.homeBase, org.homeRegion, ...org.events.map((event) => event.name)]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function mapOrganizer(org: OrganizationRecord, events: EventRecord[], disciplines?: string[]): Organizer {
  const upcoming = events
    .filter((event) => event.org_id === org.id)
    .sort((a, b) => (a.event_date ?? "9999-12-31").localeCompare(b.event_date ?? "9999-12-31"))
    .map((event): OrganizerEvent => {
      const categories = event.categories ?? [];
      const slotsLeft = event.status !== "coming_soon" && event.total_event_slots == null && categories.length > 0 && categories.every((category) =>
        Number.isFinite(category.slots_total) && Number.isFinite(category.slots_taken))
        ? categories.reduce((sum, category) => sum + Math.max(0, category.slots_total - category.slots_taken), 0)
        : null;
      return {
        id: event.id,
        name: event.name,
        slug: event.slug,
        eventDate: event.event_date,
        imageUrl: event.hero_image_url,
        place: event.city_name || event.place,
        distances: categories.map((category) => Number(category.distance_km)).filter((distance) => Number.isFinite(distance) && distance > 0).sort((a, b) => a - b),
        discipline: event.discipline,
        slotsLeft,
        registrationClosed: isRegistrationClosed(event.status, event.registration_closes_at),
        comingSoon: event.status === "coming_soon",
      };
    });
  const homeCity = org.home_city_name?.trim() || null;
  const homeProvince = org.home_province_name?.trim() || null;
  const homeRegion = org.home_region_name?.trim() || null;
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    logoUrl: org.logo_url,
    bannerUrl: org.banner_url,
    featuredImageUrl: org.featured_image_url,
    description: org.description?.trim() || null,
    homeCity,
    homeProvince,
    homeRegion,
    homeBase: homeBaseOf({ homeCity, homeProvince, homeRegion }),
    events: upcoming,
    raceTypes: [...new Set((disciplines ?? upcoming.map((event) => event.discipline)).filter((value): value is string => !!value))]
      .map((value) => DISCIPLINE_LABELS[value as EventDiscipline] ?? value),
  };
}

async function fetchUpcomingEvents(db: SupabaseClient, orgId?: string): Promise<EventRecord[]> {
  const rows: EventRecord[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = db.from("events")
      .select(EVENT_COLUMNS)
      .in("status", PUBLIC_UPCOMING_STATUSES)
      .or(`status.eq.coming_soon,event_date.gte.${philippineToday()}`)
      .order("event_date")
      .range(start, start + PAGE_SIZE - 1);
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as EventRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchPublicDisciplines(db: SupabaseClient, orgId?: string): Promise<Map<string, string[]>> {
  const byOrg = new Map<string, string[]>();
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = db.from("events")
      .select("org_id,discipline")
      .in("status", ["coming_soon", "open", "almost_full", "closed", "completed"])
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as { org_id: string; discipline: string | null }[];
    for (const event of page) {
      if (!event.discipline) continue;
      const group = byOrg.get(event.org_id) ?? [];
      group.push(event.discipline);
      byOrg.set(event.org_id, group);
    }
    if (page.length < PAGE_SIZE) return byOrg;
  }
}

export async function fetchOrganizers(db: SupabaseClient): Promise<Organizer[]> {
  const organizations: OrganizationRecord[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await db.from("organizations")
      .select(ORGANIZATION_COLUMNS)
      .eq("is_active", true)
      .order("name")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as OrganizationRecord[];
    organizations.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const [events, disciplines] = await Promise.all([fetchUpcomingEvents(db), fetchPublicDisciplines(db)]);
  const byOrg = new Map<string, EventRecord[]>();
  for (const event of events) {
    const group = byOrg.get(event.org_id) ?? [];
    group.push(event);
    byOrg.set(event.org_id, group);
  }
  return organizations
    .map((org) => mapOrganizer(org, byOrg.get(org.id) ?? [], disciplines.get(org.id) ?? []))
    .sort((a, b) => (b.events.length > 0 ? 1 : 0) - (a.events.length > 0 ? 1 : 0) || a.name.localeCompare(b.name));
}

export async function fetchOrganizer(db: SupabaseClient, slug: string): Promise<Organizer | null> {
  const { data, error } = await db.from("organizations")
    .select(ORGANIZATION_COLUMNS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const org = data as OrganizationRecord;
  const [events, disciplines] = await Promise.all([fetchUpcomingEvents(db, org.id), fetchPublicDisciplines(db, org.id)]);
  return mapOrganizer(org, events, disciplines.get(org.id) ?? []);
}
