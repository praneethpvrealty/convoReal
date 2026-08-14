import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

/**
 * Session storage for the Supabase auth client.
 *
 * expo-secure-store caps values at 2048 bytes and a Supabase session
 * (access + refresh JWT) blows past that, so we can't keep the session
 * in the keychain directly. Standard pattern from the Supabase Expo
 * guide: a per-key AES-256-CTR key lives in SecureStore (Keychain /
 * Keystore), the encrypted session lives in AsyncStorage.
 *
 * Simulators can lack keychain entitlements entirely, which makes
 * SecureStore throw and login unable to persist a session. On a
 * simulator only (`!Device.isDevice`) the AES key falls back to
 * AsyncStorage; on real hardware a keychain failure still throws —
 * the fallback can never weaken storage for an actual user.
 */
const simulatorFallback = !Device.isDevice;
const fallbackKey = (key: string) => `${key}.simulator-keychain-fallback`;

export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(
      encryptionKey,
      new aesjs.Counter(1)
    );
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    const keyHex = aesjs.utils.hex.fromBytes(encryptionKey);
    try {
      await SecureStore.setItemAsync(key, keyHex);
    } catch (e) {
      if (!simulatorFallback) throw e;
      await AsyncStorage.setItem(fallbackKey(key), keyHex);
    }
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    let encryptionKeyHex: string | null = null;
    try {
      encryptionKeyHex = await SecureStore.getItemAsync(key);
    } catch (e) {
      if (!simulatorFallback) throw e;
    }
    if (!encryptionKeyHex && simulatorFallback) {
      encryptionKeyHex = await AsyncStorage.getItem(fallbackKey(key));
    }
    if (!encryptionKeyHex) {
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return null;
    }
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.multiRemove([key, fallbackKey(key)]);
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (e) {
      if (!simulatorFallback) throw e;
    }
  }
}
