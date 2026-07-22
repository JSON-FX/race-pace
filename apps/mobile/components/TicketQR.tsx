import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Card } from "@/components/ui/card";

/**
 * Renders the signed ticket token as a scannable QR code.
 *
 * The QR's own tile is hardcoded to a white background (not a theme token)
 * so the code stays dark-modules-on-white — and therefore scannable — even
 * when the app is running in dark mode. Only the surrounding `Card` chrome
 * follows the light/dark theme.
 */
export function TicketQR({ value, size = 220 }: { value: string; size?: number }) {
  return (
    <Card className="items-center p-4">
      <View className="rounded-xl bg-white p-4" testID="ticket-qr-tile">
        <QRCode value={value} size={size} backgroundColor="#ffffff" color="#000000" />
      </View>
    </Card>
  );
}
