import { app, safeStorage } from "electron";
import { join } from "node:path";
import type { SecretStore } from "../../../src/core/contracts/credentials/secret-store.js";
import type { ProviderCredentialAccess } from "../../../src/core/contracts/credentials/renderer.js";
import { CredentialVault, type CredentialEncryption } from "./credential-vault.js";

export const osCredentialEncryption: CredentialEncryption = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value),
  // Electron's selected-backend API is Linux-only; macOS uses Keychain directly.
  ...(process.platform === "linux"
    ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() }
    : {}),
};

let secretStore: SecretStore | null = null;
let providerCredentials: ProviderCredentialAccess | null = null;

export function getCredentialSecretStore(): SecretStore {
  secretStore ??= new CredentialVault(join(app.getPath("userData"), "credential-vault.json"), osCredentialEncryption);
  return secretStore;
}

/** Electron composes the backend service after runtime bootstrap. No renderer can install it. */
export function configureProviderCredentials(access: ProviderCredentialAccess | null): void {
  providerCredentials = access;
}

export function getProviderCredentials(): ProviderCredentialAccess | null {
  return providerCredentials;
}
