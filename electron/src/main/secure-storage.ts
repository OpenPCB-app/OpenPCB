import { app } from "electron";
import { join } from "node:path";
import { CloudCredentialStorage } from "./credential-cloud-storage.js";
import { osCredentialEncryption } from "./credential-runtime.js";

let cloudStorage: CloudCredentialStorage | null = null;

function getCloudStorage(): CloudCredentialStorage {
  cloudStorage ??= new CloudCredentialStorage(
    join(app.getPath("userData"), "cloud-credential-vault.json"),
    join(app.getPath("userData"), "secure-store.json"),
    osCredentialEncryption,
  );
  return cloudStorage;
}

// Compatibility for the existing Supabase adapter only. These functions reject
// every key outside its three explicit cloud keys, including provider/SIWC refs.
export function getSecureItem(key: string): Promise<string | null> {
  return getCloudStorage().get(key);
}

export function setSecureItem(key: string, value: string): Promise<void> {
  return getCloudStorage().set(key, value);
}

export function removeSecureItem(key: string): Promise<void> {
  return getCloudStorage().remove(key);
}
