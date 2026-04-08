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
import { PcbEditorE2EHarness } from "@/testing/PcbEditorE2EHarness";
import { SchematicEditorE2EHarness } from "@/testing/SchematicEditorE2EHarness";
import { SymbolEditorE2EHarness } from "@/testing/SymbolEditorE2EHarness";
import { FootprintEditorE2EHarness } from "@/testing/FootprintEditorE2EHarness";

const e2eMode = new URLSearchParams(window.location.search).get("e2e");

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element with id 'root' not found");
}

ReactDOM.createRoot(root).render(
  e2eMode === "schematic" ? (
    <React.StrictMode>
      <BackendURLProvider>
        <ThemeProvider>
          <SchematicEditorE2EHarness />
        </ThemeProvider>
      </BackendURLProvider>
    </React.StrictMode>
  ) : e2eMode === "pcb" ? (
    <React.StrictMode>
      <BackendURLProvider>
        <ThemeProvider>
          <PcbEditorE2EHarness />
        </ThemeProvider>
      </BackendURLProvider>
    </React.StrictMode>
  ) : e2eMode === "symbol-editor" ? (
    <React.StrictMode>
      <BackendURLProvider>
        <ThemeProvider>
          <SymbolEditorE2EHarness />
        </ThemeProvider>
      </BackendURLProvider>
    </React.StrictMode>
  ) : e2eMode === "footprint-editor" ? (
    <React.StrictMode>
      <BackendURLProvider>
        <ThemeProvider>
          <FootprintEditorE2EHarness />
        </ThemeProvider>
      </BackendURLProvider>
    </React.StrictMode>
  ) : (
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
    </React.StrictMode>
  ),
);
