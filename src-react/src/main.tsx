import "./lib/react-compat";
import { initializeLogBuffer } from "@/lib/logging/log-buffer";
import React from "react";
import ReactDOM from "react-dom/client";

initializeLogBuffer();
import { ThemeProvider } from "./components/ThemeProvider.tsx";
import { BackendURLProvider } from "./contexts/BackendURLContext.tsx";
import "./styles/globals.css";
import "./styles/markdown.css";
import Layout from "@/layout/Layout.tsx";
import { GlobalStateProvider } from "./components/GlobalStateProvider.tsx";
import { SidebarButtonsProvider } from "./contexts/SidebarButtonsContext.tsx";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element with id 'root' not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BackendURLProvider>
      <ThemeProvider>
        <GlobalStateProvider>
          <SidebarButtonsProvider>
            <Layout />
          </SidebarButtonsProvider>
        </GlobalStateProvider>
      </ThemeProvider>
    </BackendURLProvider>
  </React.StrictMode>,
);
