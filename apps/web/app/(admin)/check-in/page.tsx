import { QrCode } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function CheckInPage() {
  return (
    <ComingSoon
      icon={QrCode}
      title="Check-in"
      description="Scan bibs and mark runners in on race day."
    />
  );
}
