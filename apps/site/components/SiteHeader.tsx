import Link from "next/link";
import Image from "next/image";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Race Pace home" className="flex items-center gap-2.5">
          {/* Served from public/ by path, not a static import — width and height
              are explicit so there is no layout shift. Source is 700x372. */}
          <Image src="/topnav-logo.png" alt="" width={30} height={16} priority />
          <span className="font-display text-[15px] font-extrabold tracking-[-0.2px] text-foreground">
            Race Pace
          </span>
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
