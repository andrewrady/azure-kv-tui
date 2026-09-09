import { BoxRenderable, SelectRenderable, SelectRenderableEvents, type CliRenderer, type SelectOption } from "@opentui/core";
import type { VaultInfo } from "../services/vaultDiscovery";

export type VaultPickerResult = { kind: "vault"; vault: VaultInfo } | { kind: "starred" } | { kind: "exit" };

const STARRED_LABEL = "⭐ Starred secrets";
const EXIT_LABEL = "Exit";

/** Top-level screen: pick a vault, jump to the starred-secrets shortlist, or exit. */
export async function runVaultPicker(renderer: CliRenderer, vaults: VaultInfo[]): Promise<VaultPickerResult> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      border: true,
      title: "Key Vault Secrets Browser",
      padding: 1,
    });

    const options: SelectOption[] = [
      { name: STARRED_LABEL, description: "Your cross-vault shortlist of commonly-checked secrets" },
      ...vaults.map((v) => ({ name: v.name, description: v.vaultUri })),
      { name: EXIT_LABEL, description: "Quit" },
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

    function finish(result: VaultPickerResult): void {
      select.off(SelectRenderableEvents.ITEM_SELECTED, onSelected);
      renderer.root.remove(root);
      resolve(result);
    }

    function onSelected(index: number): void {
      if (index === 0) {
        finish({ kind: "starred" });
      } else if (index === options.length - 1) {
        finish({ kind: "exit" });
      } else {
        finish({ kind: "vault", vault: vaults[index - 1]! });
      }
    }

    select.on(SelectRenderableEvents.ITEM_SELECTED, onSelected);
  });
}
