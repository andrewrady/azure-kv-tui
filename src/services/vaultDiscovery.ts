import { KeyVaultManagementClient } from "@azure/arm-keyvault";
import type { TokenCredential } from "@azure/identity";

export interface VaultInfo {
  name: string;
  vaultUri: string;
}

export function vaultInfo(name: string): VaultInfo {
  return { name, vaultUri: `https://${name}.vault.azure.net/` };
}

/**
 * Best-effort ARM discovery of every Key Vault in a subscription (Reader
 * role). Returns [] on any failure -- e.g. no Reader role -- so callers can
 * always fall back to just the explicitly-supplied vault names.
 */
export async function discoverVaultNames(credential: TokenCredential, subscriptionId: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const client = new KeyVaultManagementClient(credential, subscriptionId);
    for await (const vault of client.vaults.listBySubscription()) {
      if (vault.name) {
        names.push(vault.name);
      }
    }
  } catch {
    // Ignore -- explicit vault names (CLI/env) are still usable.
  }
  return names;
}

/**
 * Pure merge: explicit vault names (from --vault/KEYVAULT_NAMES) union
 * ARM-discovered names, deduped case-insensitively, sorted. No separate
 * "environment name" concept here -- the vault name is the label.
 */
export function mergeVaultNames(explicitNames: string[], discoveredNames: string[]): VaultInfo[] {
  const seen = new Map<string, string>(); // lowercase key -> original-case name
  for (const name of [...explicitNames, ...discoveredNames]) {
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, name);
    }
  }

  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map(vaultInfo);
}
