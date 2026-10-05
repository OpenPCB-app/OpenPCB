import { RuntimeProvider } from "./providers/RuntimeProvider";
import { BootstrapProvider } from "./providers/BootstrapProvider";
import { AppShell } from "./AppShell";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "./cloud/AuthProvider";
import { AcceptInvitePage } from "./cloud/AcceptInvitePage";
import { ErrorBoundary } from "@shared/frontend/ui/error-boundary";
import { DialogHost } from "@shared/frontend/ui/dialog-host";
import { Toaster } from "@shared/frontend/ui/toast";
import { GlobalErrors, reportRenderError } from "./shell/GlobalErrors";
import { Recovery } from "./shell/Recovery";

export function App() {
  return (
    <ThemeProvider>
      <GlobalErrors />
      <DialogHost />
      <Toaster />
      <ErrorBoundary
        scope="app"
        onError={reportRenderError}
        fallback={(props) => (
          <Recovery
            {...props}
            title="OpenPCB stopped working"
            navigationAvailable={false}
          />
        )}
      >
        <RuntimeProvider>
          <BootstrapProvider>
            <AuthProvider>
              <AppShell />
              <AcceptInvitePage />
            </AuthProvider>
          </BootstrapProvider>
        </RuntimeProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
