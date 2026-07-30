import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { appDataDir, join } from "@tauri-apps/api/path";

let strongholdInstance: Stronghold | null = null;
let storeInstance: any = null;

async function getStore() {
  if (storeInstance) return storeInstance;

  try {
    const dataDir = await appDataDir();
    const holdPath = await join(dataDir, "kognote_secure.hold");
    
    // Dynamically derive a deterministic key seed from appDataDir location
    const encoder = new TextEncoder();
    const data = encoder.encode(dataDir + "-kognote-v1");
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash << 5) - hash + data[i];
      hash |= 0;
    }
    const pin = `kognote-pin-${Math.abs(hash).toString(16)}-2026`; 

    strongholdInstance = await Stronghold.load(holdPath, pin);
    const client = await strongholdInstance.createClient("kognote_secrets");
    storeInstance = client.getStore();
    return storeInstance;
  } catch (err) {
    console.error("Failed to initialize Stronghold:", err);
    throw err;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  try {
    const store = await getStore();
    const encoded = Array.from(new TextEncoder().encode(value));
    await store.insert(key, encoded);
    if (strongholdInstance) {
      await strongholdInstance.save();
    }
  } catch (err) {
    console.error(`Failed to set secret for ${key}:`, err);
  }
}

export async function getSecret(key: string): Promise<string | null> {
  try {
    const store = await getStore();
    const record = await store.get(key);
    if (!record || record.length === 0) return null;
    return new TextDecoder().decode(new Uint8Array(record));
  } catch (err) {
    console.warn(`Failed to read secret for key: ${key}`, err);
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    const store = await getStore();
    await store.remove(key);
    if (strongholdInstance) {
      await strongholdInstance.save();
    }
  } catch (err) {
    console.error(`Failed to delete secret for ${key}:`, err);
  }
}
