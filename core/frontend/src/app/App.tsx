import { RuntimeProvider } from "./providers/RuntimeProvider";
import { BootstrapProvider } from "./providers/BootstrapProvider";
import { AppShell } from "./AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";

export function App() {
  return (
    <RuntimeProvider>
      <BootstrapProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </BootstrapProvider>
    </RuntimeProvider>
  );
}
