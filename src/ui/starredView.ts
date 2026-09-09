import { BoxRenderable, SelectRenderable, SelectRenderableEvents, type CliRenderer, type SelectOption } from "@opentui/core";
import type { TokenCredential } from "@azure/identity";
import { SecretService } from "../services/secretService";
import { vaultInfo } from "../services/vaultDiscovery";
import type { StarredSecretsService } from "../services/starredSecretsService";
import { Spinner } from "./spinner";
import { runSecretListScreen } from "./secretListScreen";

const BACK_LABEL = "<- Back";

/**
 * Cross-vault shortlist of starred secrets. Since the same secret name can
 * exist in more than one vault, every entry is labeled "[vaultName] name" so
 * they're never confused -- reachable from the vault picker.
 */
export async function runStarredView(
  renderer: CliRenderer,
  credential: TokenCredential,
  starredService: StarredSecretsService,
): Promise<void> {
  while (true) {
    const entries = starredService.getAll();

    const root = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      border: true,
      title: "⭐ Starred secrets",
    });

    const spinner = new Spinner(renderer);
    root.add(spinner.renderable);

    if (entries.length === 0) {
      const empty = new SelectRenderable(renderer, {
        width: "100%",
        height: "100%",
        flexGrow: 1,
        options: [{ name: BACK_LABEL, description: "No starred secrets yet -- star one from its details panel" }],
      });
      root.add(empty);
      renderer.root.add(root);
      empty.focus();

      await new Promise<void>((resolve) => {
        function onSelected(): void {
          empty.off(SelectRenderableEvents.ITEM_SELECTED, onSelected);
          resolve();
        }
        empty.on(SelectRenderableEvents.ITEM_SELECTED, onSelected);
      });

      renderer.root.remove(root);
      return;
    }

    const options: SelectOption[] = [
      ...entries.map((e) => ({ name: `[${e.vaultName}] ${e.secretName}`, description: "" })),
      { name: BACK_LABEL, description: "" },
    ];

    const select = new SelectRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexGrow: 1,
      options,
    });
    root.add(select);
    renderer.root.add(root);
    select.focus();

    const pickedIndex = await new Promise<number>((resolve) => {
      function onSelected(index: number): void {
        select.off(SelectRenderableEvents.ITEM_SELECTED, onSelected);
        resolve(index);
      }
      select.on(SelectRenderableEvents.ITEM_SELECTED, onSelected);
    });

    renderer.root.remove(root);

    if (pickedIndex === options.length - 1) {
      return; // back
    }

    const entry = entries[pickedIndex]!;
    const vault = vaultInfo(entry.vaultName);
    const secretService = new SecretService(vault.vaultUri, credential);

    const lookupSpinner = new Spinner(renderer);
    renderer.root.add(lookupSpinner.renderable);
    lookupSpinner.start(`Looking up ${entry.secretName} in ${entry.vaultName}...`);

    let props;
    try {
      props = await secretService.getProperties(entry.secretName);
    } finally {
      lookupSpinner.stop();
      renderer.root.remove(lookupSpinner.renderable);
    }

    if (!props) {
      continue; // secret no longer exists -- back to the starred list
    }

    await runSecretListScreen(renderer, vault, secretService, starredService, props);
  }
}
