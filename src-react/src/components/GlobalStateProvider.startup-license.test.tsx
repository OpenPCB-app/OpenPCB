import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalStateProvider } from "./GlobalStateProvider";

type MockBackendContext = {
  isReady: boolean;
  backendURL: string | null;
  startupContractVersion: number | null;
  startupLicenseState: "active" | "grace" | "restricted" | "blocked" | null;
  startupLicenseCode: string | null;
};

type MockAppState = {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  workspaces: Array<{ id: string; name: string }>;
  fetchInitialState: () => Promise<void>;
  fetchProjects: (workspaceId: string | null) => Promise<void>;
};

const mockBackendContext = vi.hoisted<MockBackendContext>(() => ({
  isReady: true,
  backendURL: "http://127.0.0.1:1234",
  startupContractVersion: 1,
  startupLicenseState: "active",
  startupLicenseCode: "TOKEN_VALID",
}));

const mockAppState = vi.hoisted<MockAppState>(() => ({
  isInitialized: true,
  isLoading: false,
  error: null,
  activeWorkspaceId: "ws-1",
  workspaces: [{ id: "ws-1", name: "Main" }],
  fetchInitialState: vi.fn(async () => {}),
  fetchProjects: vi.fn(async () => {}),
}));

vi.mock("@/contexts/BackendURLContext", () => ({
  useBackendURL: () => mockBackendContext,
}));

vi.mock("../stores/app-store", () => ({
  useAppStore: () => mockAppState,
}));

describe("GlobalStateProvider startup license gating", () => {
  beforeEach(() => {
    mockBackendContext.isReady = true;
    mockBackendContext.backendURL = "http://127.0.0.1:1234";
    mockBackendContext.startupContractVersion = 1;
    mockBackendContext.startupLicenseState = "active";
    mockBackendContext.startupLicenseCode = "TOKEN_VALID";
    mockAppState.isInitialized = true;
    mockAppState.isLoading = false;
    mockAppState.error = null;
    mockAppState.activeWorkspaceId = "ws-1";
    mockAppState.workspaces = [{ id: "ws-1", name: "Main" }];
  });

  it("renders children when startup license state is active", () => {
    render(
      <GlobalStateProvider>
        <div>Shell Ready</div>
      </GlobalStateProvider>,
    );

    expect(screen.queryByTestId("startup-license-blocked")).toBeNull();
    expect(screen.getByText("Shell Ready")).toBeDefined();
  });

  it("renders blocked gate when startup license state is blocked", () => {
    mockBackendContext.startupLicenseState = "blocked";
    mockBackendContext.startupLicenseCode = "ACCESS_BLOCKED";

    render(
      <GlobalStateProvider>
        <div>Shell Ready</div>
      </GlobalStateProvider>,
    );

    expect(screen.getByTestId("startup-license-blocked")).toBeDefined();
    expect(screen.getByText("Activate OpenPCB")).toBeDefined();
    expect(screen.getByTestId("license-key-input")).toBeDefined();
    expect(screen.queryByText("Shell Ready")).toBeNull();
  });

  it.each(["STARTUP_LICENSE_MISSING", "TOKEN_INVALID"])(
    "renders blocked gate and activation UI when blocked with %s",
    (licenseCode) => {
      mockBackendContext.startupLicenseState = "blocked";
      mockBackendContext.startupLicenseCode = licenseCode;

      render(
        <GlobalStateProvider>
          <div>Shell Ready</div>
        </GlobalStateProvider>,
      );

      expect(screen.getByTestId("startup-license-blocked")).toBeDefined();
      expect(screen.getByText("Activate OpenPCB")).toBeDefined();
      expect(screen.getByTestId("license-key-input")).toBeDefined();
      expect(screen.queryByText("Shell Ready")).toBeNull();
    },
  );

  it("renders children when startup license state is grace", () => {
    mockBackendContext.startupLicenseState = "grace";
    mockBackendContext.startupLicenseCode = null;

    render(
      <GlobalStateProvider>
        <div>Shell Ready</div>
      </GlobalStateProvider>,
    );

    expect(screen.queryByTestId("startup-license-blocked")).toBeNull();
    expect(screen.getByText("Shell Ready")).toBeDefined();
  });

  it("renders blocked gate and activation UI when blocked with GRACE_EXPIRED", () => {
    mockBackendContext.startupLicenseState = "blocked";
    mockBackendContext.startupLicenseCode = "GRACE_EXPIRED";

    render(
      <GlobalStateProvider>
        <div>Shell Ready</div>
      </GlobalStateProvider>,
    );

    expect(screen.getByTestId("startup-license-blocked")).toBeDefined();
    expect(screen.getByText("Activate OpenPCB")).toBeDefined();
    expect(screen.getByTestId("license-key-input")).toBeDefined();
    expect(screen.queryByText("Shell Ready")).toBeNull();
  });
});
