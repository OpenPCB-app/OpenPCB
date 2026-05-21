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
            <AppShell />
            <AcceptInvitePage />
          </ThemeProvider>
        </AuthProvider>
      </BootstrapProvider>
    </RuntimeProvider>
  );
}
