import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StarredEntry {
  vaultName: string;
  secretName: string;
  starredAtUtc: string;
}

const DEFAULT_DB_PATH = join(homedir(), ".kv-secrets-tui", "starred.db");

/**
 * Local SQLite store for "starred" secrets -- a personal shortlist of
 * commonly-checked secrets. Since the same secret name can exist in several
 * vaults, every entry keeps its vault name alongside the secret name so the
 * starred list can disambiguate them. Never talks to Key Vault and stores
 * nothing about a secret's value -- just which (vault, name) pairs the user
 * starred and when.
 */
export class StarredSecretsService {
  private readonly db: Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    const dir = dirname(dbPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS starred_secrets (
        vault_name TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        starred_at_utc TEXT NOT NULL,
        PRIMARY KEY (vault_name, secret_name)
      );
    `);
  }

  isStarred(vaultName: string, secretName: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM starred_secrets WHERE vault_name = ? AND secret_name = ? LIMIT 1")
      .get(vaultName, secretName);
    return row != null;
  }

  /** Toggles star state for a secret. Returns the new state (true = now starred). */
  toggleStar(vaultName: string, secretName: string): boolean {
    if (this.isStarred(vaultName, secretName)) {
      this.db.run("DELETE FROM starred_secrets WHERE vault_name = ? AND secret_name = ?", [vaultName, secretName]);
      return false;
    }

    this.db.run("INSERT INTO starred_secrets (vault_name, secret_name, starred_at_utc) VALUES (?, ?, ?)", [
      vaultName,
      secretName,
      new Date().toISOString(),
    ]);
    return true;
  }

  getAll(): StarredEntry[] {
    const rows = this.db
      .query("SELECT vault_name, secret_name, starred_at_utc FROM starred_secrets ORDER BY vault_name, secret_name")
      .all() as { vault_name: string; secret_name: string; starred_at_utc: string }[];

    return rows.map((r) => ({
      vaultName: r.vault_name,
      secretName: r.secret_name,
      starredAtUtc: r.starred_at_utc,
    }));
  }
}
