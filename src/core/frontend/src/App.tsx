import { DialogHost } from "../../../shared/frontend/ui/dialog-host";
import { AgentKitAppProvider } from "../../../shared/frontend/assistant/AgentKitAppProvider";
import { useRuntime } from "./providers/RuntimeProvider";
import type { ReactNode } from "react";
import { RuntimeProvider } from "./providers/RuntimeProvider";
import { BootstrapProvider } from "./providers/BootstrapProvider";
import { AppShell } from "./AppShell";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "./cloud/AuthProvider";
import { AcceptInvitePage } from "./cloud/AcceptInvitePage";

export function App() {
  return (
    <RuntimeProvider>
      <BootstrapProvider>
        <AuthProvider>
          <ThemeProvider>
            <AssistantRuntimeProvider><AppShell /><AcceptInvitePage /><DialogHost /></AssistantRuntimeProvider>
          </ThemeProvider>
        </AuthProvider>
      </BootstrapProvider>
    </RuntimeProvider>
  );
}

function AssistantRuntimeProvider({ children }: { children: ReactNode }) {
  const { backendURL } = useRuntime();
  return backendURL ? <AgentKitAppProvider baseUrl={`${backendURL}/api/modules/assistant`}>{children}</AgentKitAppProvider> : children;
}
