import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";

let cached: TokenCredential | undefined;

/** A single shared DefaultAzureCredential for the whole app (works with `az login`, env vars, managed identity, etc.). */
export function getCredential(): TokenCredential {
  return (cached ??= new DefaultAzureCredential());
}
