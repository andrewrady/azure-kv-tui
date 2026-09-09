import { SubscriptionClient } from "@azure/arm-subscriptions";
import type { TokenCredential } from "@azure/identity";

export interface SubscriptionInfo {
  subscriptionId: string;
  displayName: string;
}

/** Lists every Azure subscription the signed-in identity (az login, etc.) can access. */
export async function listAccessibleSubscriptions(credential: TokenCredential): Promise<SubscriptionInfo[]> {
  const client = new SubscriptionClient(credential);
  const results: SubscriptionInfo[] = [];
  for await (const sub of client.subscriptions.list()) {
    if (sub.subscriptionId) {
      results.push({ subscriptionId: sub.subscriptionId, displayName: sub.displayName ?? sub.subscriptionId });
    }
  }
  return results;
}
