import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PlatformUser } from "@/lib/queries/platform-users";

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-3.5" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.26h2.909c1.702-1.567 2.684-3.875 2.684-6.616Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.179l-2.909-2.26c-.806.54-1.835.86-3.047.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.322 0 2.508.455 3.441 1.346l2.582-2.582C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

export function ProviderBadge({ provider }: { provider: PlatformUser["provider"] }) {
  if (provider === "google") {
    return <Badge variant="secondary" className="gap-1.5"><GoogleMark />Google</Badge>;
  }
  if (provider === "email") {
    return <Badge variant="secondary" className="gap-1.5"><Mail className="size-3.5" />Email + password</Badge>;
  }
  return <Badge variant="outline">Other provider</Badge>;
}
