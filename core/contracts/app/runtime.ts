export type AppRuntime = "web" | "electron";

export interface ElectronBackendPayload {
  url: string;
  port: number;
}
