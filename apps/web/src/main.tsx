import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { OrgProvider } from "./lib/orgContext";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Inside AuthProvider — it reads the session; and inside
            QueryClientProvider — it owns the user_roles query. */}
        <OrgProvider>
          <App />
          <Toaster position="bottom-right" richColors />
        </OrgProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
