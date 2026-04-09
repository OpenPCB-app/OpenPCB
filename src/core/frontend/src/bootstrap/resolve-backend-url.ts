import type {
  AppRuntime,
  ElectronBackendPayload,
} from "../../../contracts/app/runtime";

export async function resolveBackendURL(runtime: AppRuntime): Promise<string> {
  if (runtime === "web") {
    return window.location.origin;
  }

  const payload = await window.electronAPI?.getBackendUrl();
  if (payload?.url) {
    return payload.url;
  }

  const isFileProtocol = window.location.protocol === "file:";
  if (isFileProtocol) {
    throw new Error("Electron backend URL unavailable");
  }

  return window.location.origin;
}

export function listenForElectronBackendReady(
  onReady: (payload: ElectronBackendPayload) => void,
): void {
  if (!window.electronAPI) {
    return;
  }

  window.electronAPI.onBackendReady((payload) => {
    if (!payload?.url || typeof payload.port !== "number") {
      return;
    }

    onReady({ url: payload.url, port: payload.port });
  });
}
