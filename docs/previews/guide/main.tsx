import { createRoot } from "react-dom/client";
import { GuidePrototype } from "./GuidePrototype";
const choice = Math.max(0, Math.min(4, Number(new URLSearchParams(location.search).get("choice") ?? 1) - 1));
createRoot(document.getElementById("root")!).render(<GuidePrototype initialChoice={choice} />);
