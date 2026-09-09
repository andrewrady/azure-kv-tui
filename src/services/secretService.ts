import { SecretClient, type SecretProperties, type KeyVaultSecret } from "@azure/keyvault-secrets";
import type { TokenCredential } from "@azure/identity";

/**
 * Strictly read-only wrapper over SecretClient. Only ever calls
 * listPropertiesOfSecrets / listPropertiesOfSecretVersions (metadata) and
 * getSecret (value). Deliberately does NOT expose setSecret,
 * updateSecretProperties, beginDeleteSecret, purgeDeletedSecret, or any
 * other create/update/delete API.
 */
export class SecretService {
  private readonly client: SecretClient;

  constructor(vaultUri: string, credential: TokenCredential) {
    this.client = new SecretClient(vaultUri, credential);
  }

  /**
   * Server-side pages of secret metadata, fetched lazily -- a REST call
   * only happens when the caller actually advances to the next page.
   */
  pages(pageSize: number): AsyncIterableIterator<SecretProperties[]> {
    return this.client.listPropertiesOfSecrets().byPage({ maxPageSize: pageSize });
  }

  /**
   * Looks up one secret's metadata (across all its versions) without
   * touching its value -- used for the starred-secrets view, where we only
   * have a name and need its current properties.
   */
  async getProperties(name: string): Promise<SecretProperties | undefined> {
    let latest: SecretProperties | undefined;
    for await (const props of this.client.listPropertiesOfSecretVersions(name)) {
      const propsTime = props.createdOn?.getTime() ?? 0;
      const latestTime = latest?.createdOn?.getTime() ?? -1;
      if (!latest || propsTime >= latestTime) {
        latest = props;
      }
    }
    return latest;
  }

  async getValue(name: string): Promise<string> {
    const secret: KeyVaultSecret = await this.client.getSecret(name);
    return secret.value ?? "";
  }
}
