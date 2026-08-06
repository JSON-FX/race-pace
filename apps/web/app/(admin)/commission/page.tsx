import { Percent } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function CommissionPage() {
  return (
    <ComingSoon
      icon={Percent}
      title="Commission"
      description="Platform fee rollups per organizer and per event."
    />
  );
}
