import { NavLink } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { useAuth } from "../lib/auth";
import mark from "../assets/topnav-logo.png";

const ORG_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/events", label: "Events" },
  { to: "/registrations", label: "Registrations" },
  { to: "/payments", label: "Payments" },
  { to: "/check-in", label: "Check-in" },
  { to: "/team", label: "Team" },
  { to: "/settings", label: "Settings" },
];
const SUPER_ITEMS = [
  { to: "/organizations", label: "Organizations" },
  { to: "/commission", label: "Commission" },
  { to: "/payouts", label: "Payouts" },
];

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} style={({ isActive }) => ({
      display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
      textDecoration: "none", fontSize: 14, fontWeight: isActive ? 600 : 500,
      color: isActive ? "var(--ink)" : "var(--ink-muted)",
      background: isActive ? "var(--nav-active)" : "transparent",
    })}>
      {({ isActive }) => (
        <>
          <span style={{ width: 18, height: 18, borderRadius: 5, flex: "none", background: isActive ? "var(--primary)" : "var(--ink-faint)" }} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

const sectionStyle = { fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: "var(--section)", padding: "6px 12px" } as const;

export function Sidebar() {
  const roles = useMyRoles();
  const { session, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.data?.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <nav style={{ width: 248, flex: "none", background: "var(--canvas)", borderRight: "1px solid var(--hairline)", display: "flex", flexDirection: "column", padding: "22px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 10px 18px" }}>
        <img src={mark} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.3px" }}>Race Pace</div>
          <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Admin console</div>
        </div>
      </div>

      <div style={sectionStyle}>ORGANIZATION</div>
      {ORG_ITEMS.filter((it) => it.to !== "/team" || roles.data?.isOrgAdmin).map((it) => <NavItem key={it.to} {...it} />)}

      {roles.data?.isSuperAdmin ? (
        <>
          <div style={{ ...sectionStyle, padding: "16px 12px 6px" }}>PLATFORM · SUPER ADMIN</div>
          {SUPER_ITEMS.map((it) => <NavItem key={it.to} {...it} />)}
        </>
      ) : null}

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "12px 8px 2px", borderTop: "1px solid var(--divider)" }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--forest)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flex: "none" }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{local}</div>
          <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>{role}</div>
        </div>
        <span onClick={() => signOut()} role="button" style={{ color: "var(--danger)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Sign out</span>
      </div>
    </nav>
  );
}
