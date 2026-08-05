import Link from "next/link";
import Image from "next/image";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Race Pace home" className="flex items-center">
          {/* The asset already carries the wordmark, so no text sibling — a
              second "Race Pace" beside it read as a duplicate. Served from
              public/ by path, not a static import; width and height are
              explicit so there is no layout shift. Source is 700x372, and
              these keep that 1.882 aspect ratio. */}
          <Image src="/topnav-logo.png" alt="Race Pace" width={98} height={52} priority />
        </Link>
        <nav className="flex items-center gap-6 text-[14px] font-medium">
          <Link href="/events" className="text-foreground transition-colors hover:text-primary">
            Races
          </Link>
          <Link href="/races" className="text-foreground transition-colors hover:text-primary">
            My Races
          </Link>
          <Link href="/profile" className="text-foreground transition-colors hover:text-primary">
            Profile
          </Link>
        </nav>
      </div>
    </header>
  );
}
