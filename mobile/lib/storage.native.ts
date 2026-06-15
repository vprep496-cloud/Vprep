/**
 * Secure storage — native implementation (iOS & Android).
 *
 * Uses expo-secure-store (device Keychain/Keystore) for proper at-rest
 * encryption.  Metro picks this file on iOS/Android and lib/storage.ts
 * (localStorage) on web.
 */
import * as SecureStore from "expo-secure-store";

export async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
