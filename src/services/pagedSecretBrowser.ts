import type { SecretProperties } from "@azure/keyvault-secrets";

/**
 * Buffers secret metadata fetched lazily a page at a time, only calling Key
 * Vault when the caller needs more than is already buffered. Calling
 * ensureBuffered(Infinity) drains every page, which is how a full-vault
 * search is loaded.
 *
 * Safe to call concurrently -- a background prefetch (topping up the buffer
 * while the user keeps scrolling) and a foreground "need it now" call can
 * overlap: only one fetch loop ever runs at a time, and a caller that shows
 * up while one is in flight just awaits it, then tops up further only if
 * still short.
 *
 * Decoupled from SecretService -- takes a page-source function instead --
 * so it can be unit tested with a fake page sequence.
 */
export class PagedSecretBrowser {
  private buffer: SecretProperties[] = [];
  private exhausted = false;
  private pageIterator: AsyncIterableIterator<SecretProperties[]> | undefined;
  private fetching: Promise<void> | null = null;

  constructor(private readonly pageSource: () => AsyncIterableIterator<SecretProperties[]>) {}

  get isExhausted(): boolean {
    return this.exhausted;
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  /** A snapshot copy -- unaffected by buffering that happens after it's taken. */
  snapshot(): SecretProperties[] {
    return [...this.buffer];
  }

  async ensureBuffered(count: number, onBuffered?: (count: number) => void): Promise<void> {
    if (this.exhausted || this.buffer.length >= count) {
      return;
    }

    if (this.fetching) {
      await this.fetching;
      if (this.exhausted || this.buffer.length >= count) {
        return;
      }
    }

    const run = this.fetchUntil(count, onBuffered);
    this.fetching = run.finally(() => {
      this.fetching = null;
    });
    await this.fetching;
  }

  private async fetchUntil(count: number, onBuffered?: (count: number) => void): Promise<void> {
    this.pageIterator ??= this.pageSource();

    while (this.buffer.length < count) {
      const { value, done } = await this.pageIterator.next();
      if (done) {
        this.exhausted = true;
        break;
      }
      this.buffer.push(...value);
      onBuffered?.(this.buffer.length);
    }
  }
}
