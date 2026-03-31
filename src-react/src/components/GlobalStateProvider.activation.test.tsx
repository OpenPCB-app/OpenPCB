import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GlobalStateProvider } from "./GlobalStateProvider";
import * as authApi from "@/lib/api/auth-api";

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

vi.mock("@/lib/api/auth-api", async () => {
  const actual = await vi.importActual("@/lib/api/auth-api");
  return {
    ...actual,
    activateLicense: vi.fn(),
    replaceDevice: vi.fn(),
  };
});

describe("GlobalStateProvider activation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackendContext.isReady = true;
    mockBackendContext.startupLicenseState = "active";
    mockAppState.isInitialized = true;
    mockAppState.activeWorkspaceId = "ws-1";
  });

  it("unblocks when activation is successful", async () => {
    mockBackendContext.startupLicenseState = "blocked";
    mockBackendContext.startupLicenseCode = "MISSING";
    
    vi.mocked(authApi.activateLicense).mockResolvedValue({
      success: true,
      license: { state: "active", expiresAt: null, features: [] }
    });

    render(
      <GlobalStateProvider>
        <div data-testid="app-content">App Content</div>
      </GlobalStateProvider>
    );

    expect(screen.queryByTestId("app-content")).toBeNull();
    
    const input = screen.getByTestId("license-key-input");
    const button = screen.getByTestId("activate-button");

    fireEvent.change(input, { target: { value: "VALID-KEY" } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("app-content")).toBeDefined();
    });
  });

  it("shows replacement dialog when limit reached and unblocks after replacement", async () => {
    mockBackendContext.startupLicenseState = "blocked";
    
    vi.mocked(authApi.activateLicense).mockResolvedValue({
      success: false,
      requiresReplacement: true,
      devices: [
        { id: "dev-1", name: "Old Device", lastActive: new Date().toISOString() }
      ]
    });

    vi.mocked(authApi.replaceDevice).mockResolvedValue({
      success: true,
      license: { state: "active", expiresAt: null, features: [] }
    });

    render(
      <GlobalStateProvider>
        <div data-testid="app-content">App Content</div>
      </GlobalStateProvider>
    );

    fireEvent.change(screen.getByTestId("license-key-input"), { target: { value: "KEY" } });
    fireEvent.click(screen.getByTestId("activate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("replacement-dialog")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("replace-device-dev-1"));

    await waitFor(() => {
      expect(screen.getByTestId("app-content")).toBeDefined();
    });
  });

  it("stays blocked if replacement is cancelled", async () => {
    mockBackendContext.startupLicenseState = "blocked";
    
    vi.mocked(authApi.activateLicense).mockResolvedValue({
      success: false,
      requiresReplacement: true,
      devices: [
        { id: "dev-1", name: "Old Device", lastActive: new Date().toISOString() }
      ]
    });

    render(
      <GlobalStateProvider>
        <div data-testid="app-content">App Content</div>
      </GlobalStateProvider>
    );

    fireEvent.change(screen.getByTestId("license-key-input"), { target: { value: "KEY" } });
    fireEvent.click(screen.getByTestId("activate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("replacement-dialog")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("cancel-replacement"));

    await waitFor(() => {
      expect(screen.queryByTestId("replacement-dialog")).toBeNull();
    });
    
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.getByTestId("startup-license-blocked")).toBeDefined();
  });
});
