import { redirect } from "next/navigation";
import { Building2, FileText, ImageIcon, ScanLine } from "lucide-react";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getOrg } from "@/lib/queries/org";
import { NoOrgScope } from "@/components/no-org-scope";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { initials } from "@/lib/format";
import { WaiverForm } from "./waiver-form";
import { getWaiverVersions, getEventWaiverSettings } from "@/lib/queries/waivers";
import { SettingsForm } from "./settings-form";
import { AdminCanvasPreference } from "@/components/AdminCanvasPreference";

export default async function SettingsPage() {
  const roles = await getMyRoles();
  // See app/(admin)/dashboard/page.tsx's identical guard: the (admin)
  // layout only asserts SOME capability (check_in included), so a marshal
  // clears it — this page must assert manage_org itself, and redirect()
  // rather than notFound().
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  // See requireOrgId's doc comment: a bare super_admin clears the (admin)
  // layout's isAdmin guard with orgId: null. Branch before calling any
  // org-scoped query, don't assert the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="fieldnotes-admin-workspace" data-fieldnotes-section="Organization / Settings">
        <div className="mb-5">
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Settings</h1>
        </div>
        <AdminCanvasPreference />
        <NoOrgScope />
      </div>
    );
  }

  const [org, waivers, eventWaivers] = await Promise.all([getOrg(orgId), getWaiverVersions(orgId), getEventWaiverSettings(orgId)]);
  const canEdit = roles!.isOrgAdmin;

  const sections = [
    { id: "profile", label: "Profile", icon: Building2 },
    { id: "branding", label: "Branding", icon: ImageIcon },
    { id: "checkin", label: "Event check-in", icon: ScanLine },
    { id: "waiver", label: "Organizer waiver", icon: FileText },
  ];

  return (
    <div className="fieldnotes-admin-workspace" data-fieldnotes-section="Organization / Settings">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[clamp(23px,2.2vw,30px)] font-bold tracking-[-0.035em]">Organization settings</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-muted-foreground">
            Manage your public identity, event defaults, and participant waiver policy.
          </p>
        </div>
        <Badge variant="outline" className="gap-2 rounded-pill bg-card px-3 py-1.5 text-[11px] font-bold shadow-card">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          {canEdit ? "Admin access" : "Read-only access"}
        </Badge>
      </div>

      <section
        aria-label="Public organization identity preview"
        className="relative mb-[18px] h-[228px] overflow-hidden rounded-[18px] bg-forest shadow-card"
      >
        {org.banner_url ? (
          // Organization branding is already constrained to the org-images
          // bucket. A plain image preserves the saved crop without adding a
          // second image transformation layer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.banner_url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-forest">
            <span className="absolute -right-16 -top-24 size-72 rounded-full bg-primary/35 blur-3xl" />
            <span className="absolute -bottom-28 left-1/3 size-80 rounded-full bg-secondary/25 blur-3xl" />
            <span className="absolute right-[12%] top-[18%] h-px w-2/3 -rotate-6 bg-white/25 shadow-[0_12px_0_rgb(255_255_255/0.14),0_24px_0_rgb(255_255_255/0.08)]" />
          </div>
        )}
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-forest/90 via-forest/20 to-transparent p-5 text-white md:p-[22px]">
          <span className="grid size-[66px] shrink-0 place-items-center overflow-hidden rounded-full border-[3px] border-white/70 bg-forest text-[17px] font-extrabold shadow-lg">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="size-full object-cover" />
            ) : initials(org.name)}
          </span>
          <span className="ml-3 min-w-0">
            <strong className="block truncate text-[19px] tracking-[-0.02em]">{org.name}</strong>
            <span className="text-[11px] text-white/70">Public organization identity preview</span>
          </span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="self-start lg:sticky lg:top-20">
          <Card className="hidden gap-0 rounded-xl p-2.5 shadow-card lg:block">
            <p className="px-2.5 pb-1.5 pt-2 text-[9px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Organization
            </p>
            <nav aria-label="Settings sections">
              {sections.map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
                >
                  <Icon className="size-4" strokeWidth={1.9} aria-hidden="true" />
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-2 border-t border-divider px-3 pb-2 pt-3 text-[10px] leading-relaxed text-muted-foreground">
              <strong className="mb-1 block text-[11px] text-foreground">Changes stay scoped</strong>
              Only {org.name} is affected.
            </div>
          </Card>
          <AdminCanvasPreference compact />
        </aside>

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <SettingsForm key={org.id} org={org} canEdit={canEdit} />
          <WaiverForm orgId={orgId} versions={waivers} events={eventWaivers} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
