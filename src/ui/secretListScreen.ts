import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type SelectOption,
} from "@opentui/core";
import type { SecretProperties } from "@azure/keyvault-secrets";
import type { VaultInfo } from "../services/vaultDiscovery";
import type { SecretService } from "../services/secretService";
import { PagedSecretBrowser } from "../services/pagedSecretBrowser";
import type { StarredSecretsService } from "../services/starredSecretsService";
import { Spinner } from "./spinner";

const PAGE_SIZE = 25;
const PREFETCH_THRESHOLD = 5;

/**
 * Split-layout screen: search box on top, secret list on the bottom-left,
 * details panel on the bottom-right once a secret is opened. Continuous
 * scroll -- the list keeps appending secrets as the user nears the end of
 * what's loaded, with a background prefetch topping up the buffer just
 * ahead of them (same underlying idea as the .NET app's page-ahead
 * prefetch, adapted to OpenTUI's Select instead of discrete pages).
 *
 * Only exits (resolves) when the user backs out with Esc from the top level.
 */
export async function runSecretListScreen(
  renderer: CliRenderer,
  vault: VaultInfo,
  secretService: SecretService,
  starredService: StarredSecretsService,
  /** When set, opens directly on this one secret's details instead of the list (used by the starred view). */
  initialSecret?: SecretProperties,
): Promise<void> {
  const browser = new PagedSecretBrowser(() => secretService.pages(PAGE_SIZE));

  let source: SecretProperties[] = initialSecret ? [initialSecret] : [];
  let matches: SecretProperties[] = source;
  let filterText = "";
  let searchFocused = false;

  const starredNames = new Set(
    starredService.getAll().filter((e) => e.vaultName === vault.name).map((e) => e.secretName),
  );

  let detail: SecretProperties | null = null;
  let detailAnswered = false;
  let detailRevealed = false;
  let detailValue = "";
  let detailError = "";
  let detailBoxAttached = false;

  // --- build the tree ---
  const root = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    border: true,
    title: `Secrets in ${vault.name}`,
  });

  const searchBox = new BoxRenderable(renderer, {
    width: "100%",
    height: 3,
    border: true,
    title: "Search (/ to focus, Esc to clear)",
  });
  const searchInput = new InputRenderable(renderer, {
    width: "100%",
    placeholder: "type to filter...",
  });
  searchBox.add(searchInput);

  const body = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row" });

  const listBox = new BoxRenderable(renderer, { flexGrow: 3, height: "100%", border: true, title: "Secrets" });
  const select = new SelectRenderable(renderer, { width: "100%", height: "100%", flexGrow: 1, options: [] });
  listBox.add(select);
  body.add(listBox);

  const detailBox = new BoxRenderable(renderer, { flexGrow: 2, height: "100%", border: true, title: "" });
  const detailText = new TextRenderable(renderer, { content: "" });
  detailBox.add(detailText);

  const spinner = new Spinner(renderer);
  const footer = new TextRenderable(renderer, { content: "" });

  root.add(searchBox);
  root.add(body);
  root.add(spinner.renderable);
  root.add(footer);
  renderer.root.add(root);

  select.focus();

  // --- helpers ---
  function updateFooter(): void {
    footer.content = detail
      ? "y reveal value · n hide · s star/unstar · Esc close panel"
      : "Enter view details · / search · Esc back";
  }

  function describeSecret(props: SecretProperties): SelectOption {
    const star = starredNames.has(props.name) ? "★ " : "  ";
    return {
      name: `${star}${props.name}`,
      description: props.enabled === false ? "disabled" : "",
    };
  }

  function refreshList(preserveIndex = true): void {
    const prevIndex = select.getSelectedIndex();
    matches = filterText
      ? source.filter((s) => s.name.toLowerCase().includes(filterText.toLowerCase()))
      : source;
    select.options = matches.map(describeSecret);
    if (preserveIndex && matches.length > 0) {
      select.selectedIndex = Math.min(Math.max(prevIndex, 0), matches.length - 1);
    }
  }

  async function ensureInitialLoad(): Promise<void> {
    if (initialSecret) {
      return; // starred-view single-secret mode -- nothing to fetch
    }
    if (browser.bufferedCount === 0) {
      spinner.start(`Loading secrets in ${vault.name}...`);
      await browser.ensureBuffered(PAGE_SIZE, (n) => spinner.setLabel(`Loading secrets in ${vault.name}... (${n} loaded)`));
      spinner.stop();
      source = browser.snapshot();
      refreshList(false);
    }
  }

  async function maybePrefetch(selectedIndex: number): Promise<void> {
    if (initialSecret || browser.isExhausted || filterText) {
      return;
    }
    if (selectedIndex >= matches.length - PREFETCH_THRESHOLD) {
      await browser.ensureBuffered(browser.bufferedCount + PAGE_SIZE);
      source = browser.snapshot();
      refreshList();
    }
  }

  async function loadEverythingForSearch(): Promise<void> {
    if (initialSecret || browser.isExhausted) {
      return;
    }
    spinner.start(`Loading all secrets in ${vault.name} for search...`);
    await browser.ensureBuffered(Infinity, (n) =>
      spinner.setLabel(`Loading all secrets in ${vault.name} for search... (${n} loaded)`),
    );
    spinner.stop();
    source = browser.snapshot();
    refreshList(false);
  }

  function renderDetail(): void {
    if (!detail) {
      return;
    }
    const isStarred = starredNames.has(detail.name);
    detailBox.title = isStarred ? `★ ${detail.name}` : detail.name;

    const tags = detail.tags
      ? Object.entries(detail.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "none";

    const lines = [
      `Enabled: ${detail.enabled ?? "unknown"}`,
      `Created: ${detail.createdOn?.toISOString() ?? "unknown"}`,
      `Updated: ${detail.updatedOn?.toISOString() ?? "unknown"}`,
      `Expires: ${detail.expiresOn?.toISOString() ?? "none"}`,
      `Content-Type: ${detail.contentType ?? "none"}`,
      `Tags: ${tags}`,
      `Starred: ${isStarred ? "yes" : "no"}`,
      "",
    ];

    if (detailError) {
      lines.push(`Failed to load value: ${detailError}`);
    } else if (!detailAnswered) {
      lines.push("Reveal secret value? (y/n)");
    } else if (detailRevealed) {
      lines.push(`Value: ${detailValue}`);
    } else {
      lines.push("(value hidden)");
    }

    detailText.content = lines.join("\n");
  }

  function openDetail(props: SecretProperties): void {
    detail = props;
    detailAnswered = false;
    detailRevealed = false;
    detailValue = "";
    detailError = "";
    renderDetail();
    if (!detailBoxAttached) {
      body.add(detailBox);
      detailBoxAttached = true;
    }
    updateFooter();
  }

  function closeDetail(): void {
    detail = null;
    if (detailBoxAttached) {
      body.remove(detailBox);
      detailBoxAttached = false;
    }
    updateFooter();
  }

  function focusSearch(): void {
    searchFocused = true;
    searchInput.focus();
  }

  function blurSearch(): void {
    searchFocused = false;
    filterText = "";
    searchInput.value = "";
    select.focus();
    refreshList(false);
  }

  // --- event wiring ---
  let resolveScreen: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveScreen = resolve;
  });

  function onSelectionChanged(index: number): void {
    void maybePrefetch(index);
  }

  function onItemSelected(index: number): void {
    const props = matches[index];
    if (props) {
      openDetail(props);
    }
  }

  function onInputChanged(value: string): void {
    filterText = value;
    refreshList(false);
  }

  async function onKeypress(key: KeyEvent): Promise<void> {
    if (key.name === "escape") {
      if (detail) {
        closeDetail();
        return;
      }
      if (searchFocused) {
        blurSearch();
        return;
      }
      resolveScreen();
      return;
    }

    if (detail) {
      if (!detailAnswered && key.name === "y") {
        try {
          detailValue = await secretService.getValue(detail.name);
          detailRevealed = true;
        } catch (err) {
          detailError = err instanceof Error ? err.message : String(err);
        } finally {
          detailAnswered = true;
        }
        renderDetail();
        return;
      }

      if (!detailAnswered && key.name === "n") {
        detailAnswered = true;
        detailRevealed = false;
        renderDetail();
        return;
      }

      if (key.name === "s") {
        const nowStarred = starredService.toggleStar(vault.name, detail.name);
        if (nowStarred) {
          starredNames.add(detail.name);
        } else {
          starredNames.delete(detail.name);
        }
        renderDetail();
        refreshList();
        return;
      }

      return; // list navigation is paused while the details panel is open
    }

    if (key.sequence === "/") {
      key.preventDefault();
      if (searchFocused) {
        blurSearch();
        return;
      }
      await loadEverythingForSearch();
      focusSearch();
    }
  }

  select.on(SelectRenderableEvents.SELECTION_CHANGED, onSelectionChanged);
  select.on(SelectRenderableEvents.ITEM_SELECTED, onItemSelected);
  searchInput.on(InputRenderableEvents.INPUT, onInputChanged);
  renderer.keyInput.on("keypress", onKeypress);

  updateFooter();
  refreshList(false);
  await ensureInitialLoad();

  if (initialSecret) {
    openDetail(initialSecret);
  }

  await done;

  // --- teardown ---
  renderer.keyInput.off("keypress", onKeypress);
  select.off(SelectRenderableEvents.SELECTION_CHANGED, onSelectionChanged);
  select.off(SelectRenderableEvents.ITEM_SELECTED, onItemSelected);
  searchInput.off(InputRenderableEvents.INPUT, onInputChanged);
  renderer.root.remove(root);
}
