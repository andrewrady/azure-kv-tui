#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createInterface } from "node:readline/promises";
import type { TokenCredential } from "@azure/identity";
import { getCredential } from "./services/auth";
import { discoverVaultNames, mergeVaultNames } from "./services/vaultDiscovery";
import { listAccessibleSubscriptions } from "./services/subscriptionDiscovery";
import { SecretService } from "./services/secretService";
import { StarredSecretsService } from "./services/starredSecretsService";
import { runVaultPicker } from "./ui/vaultPicker";
import { runSecretListScreen } from "./ui/secretListScreen";
import { runStarredView } from "./ui/starredView";

interface Args {
  subscriptionId?: string;
  vaultNames: string[];
}

function parseArgs(argv: string[]): Args {
  let subscriptionId: string | undefined;
  const vaultNames: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--subscription" && next) {
      subscriptionId = next;
      i++;
    } else if (arg === "--vault" && next) {
      vaultNames.push(next);
      i++;
    }
  }

  return { subscriptionId, vaultNames };
}

async function promptForSubscriptionId(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Azure subscription ID (used to discover Key Vaults): ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function promptForChoice(count: number): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question(`Select a subscription (1-${count}): `)).trim();
      const choice = Number.parseInt(answer, 10);
      if (Number.isInteger(choice) && choice >= 1 && choice <= count) {
        return choice - 1;
      }
      console.log(`Please enter a number from 1 to ${count}.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Resolves which subscription to browse without asking the user to paste an
 * ID: lists every subscription their signed-in identity (az login, etc.) can
 * access. Auto-picks it if there's exactly one, otherwise prompts with a
 * numbered list. Falls back to a manual prompt only if none were found (or
 * the account has no ARM access at all).
 */
async function resolveSubscriptionId(credential: TokenCredential, explicit: string | undefined): Promise<string> {
  if (explicit) {
    return explicit;
  }

  console.log("Looking up subscriptions you have access to...");
  const subscriptions = await listAccessibleSubscriptions(credential);

  if (subscriptions.length === 0) {
    console.log("No subscriptions found for your signed-in account.");
    return promptForSubscriptionId();
  }

  if (subscriptions.length === 1) {
    const only = subscriptions[0]!;
    console.log(`Using subscription: ${only.displayName} (${only.subscriptionId})`);
    return only.subscriptionId;
  }

  console.log("Multiple subscriptions found:");
  subscriptions.forEach((sub, i) => console.log(`  ${i + 1}. ${sub.displayName} (${sub.subscriptionId})`));
  const index = await promptForChoice(subscriptions.length);
  return subscriptions[index]!.subscriptionId;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const envVaultNames = (process.env.KEYVAULT_NAMES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const explicitVaultNames = [...args.vaultNames, ...envVaultNames];

  const credential = getCredential();
  const starredService = new StarredSecretsService();

  const subscriptionId = await resolveSubscriptionId(credential, args.subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID);

  console.log("Discovering Key Vaults...");
  const discovered = await discoverVaultNames(credential, subscriptionId);
  const vaults = mergeVaultNames(explicitVaultNames, discovered);

  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  try {
    while (true) {
      const result = await runVaultPicker(renderer, vaults);

      if (result.kind === "exit") {
        break;
      }

      if (result.kind === "starred") {
        await runStarredView(renderer, credential, starredService);
        continue;
      }

      const secretService = new SecretService(result.vault.vaultUri, credential);
      await runSecretListScreen(renderer, result.vault, secretService, starredService);
    }
  } finally {
    renderer.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
