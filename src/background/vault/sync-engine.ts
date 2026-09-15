import { VaultConflictError, type VaultBackend, type VaultObjectKind } from "../../shared/vault";
import { EncryptedVaultCache } from "./local-cache";

export interface VaultSyncStatus {
  state: "synced" | "offline" | "conflict" | "pending";
  dirty: number;
  conflicts: number;
}
export interface VaultSyncResult extends VaultSyncStatus { uploaded: number; downloaded: number; }

/** Reconciles opaque encrypted objects; it never decrypts them. */
export class VaultSyncEngine {
  constructor(private readonly cache: EncryptedVaultCache, private readonly remote: VaultBackend) {}

  async synchronize(): Promise<VaultSyncResult> {
    try {
      await this.remote.connect();
      let uploaded = 0;
      for (const record of await this.cache.records()) {
        if (record.syncState !== "dirty") continue;
        try {
          const stored = await this.remote.put(record.id, record.data, record.remoteRevision);
          await this.cache.markClean(record.id, stored.revision);
          uploaded += 1;
        } catch (error) {
          if (error instanceof VaultConflictError || isConflict(error)) await this.cache.markConflict(record.id);
          else throw error;
        }
      }
      const downloaded = await this.pull();
      return { ...(await this.status()), uploaded, downloaded };
    } catch {
      return { ...(await this.status()), state: "offline", uploaded: 0, downloaded: 0 };
    }
  }

  async pull(): Promise<number> {
    const remoteMetas = await this.remote.list();
    const remoteIds = new Set(remoteMetas.map((meta) => meta.id));
    let downloaded = 0;
    for (const meta of remoteMetas) {
      const local = await this.cache.record(meta.id);
      if (!local) { const object = await this.remote.get(meta.id); if (object) { await this.cache.acceptRemote(object, meta.kind ?? kindFor(meta.id)); downloaded += 1; } continue; }
      if (local.remoteRevision === meta.revision) continue;
      if (local.syncState === "clean") { const object = await this.remote.get(meta.id); if (object) { await this.cache.acceptRemote(object, meta.kind ?? kindFor(meta.id)); downloaded += 1; } continue; }
      await this.cache.markConflict(meta.id);
    }
    for (const local of await this.cache.records()) if (!remoteIds.has(local.id) && local.remoteRevision) await this.cache.markConflict(local.id);
    return downloaded;
  }

  async status(): Promise<VaultSyncStatus> {
    const records = await this.cache.records();
    const dirty = records.filter((record) => record.syncState === "dirty").length;
    const conflicts = records.filter((record) => record.syncState === "conflict").length;
    return { state: conflicts ? "conflict" : dirty ? "pending" : "synced", dirty, conflicts };
  }
}

function kindFor(id: string): VaultObjectKind | undefined { if (id === "manifest") return "manifest"; if (id.startsWith("app_")) return "app"; if (id.startsWith("account_")) return "account"; if (id.startsWith("credential_")) return "credential"; return undefined; }
function isConflict(value: unknown): boolean { return value instanceof Error && (value as Error & { code?: unknown }).code === "revision-conflict"; }
