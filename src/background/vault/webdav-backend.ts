import { fetchWithTimeout } from "../../shared/fetch";
import { normalizeWebDavUrl } from "../../shared/url";
import {
  VaultConflictError,
  WebDavCompatibilityError,
  type RevisionToken,
  type StoredObject,
  type StoredObjectMeta,
  type VaultBackend,
} from "../../shared/vault";

const OBJECTS_DIRECTORY = "objects/";

export class WebDavBackend implements VaultBackend {
  readonly endpoint: string;
  private readonly username: string;
  private readonly appPassword: string;

  constructor(endpoint: string, username: string, appPassword: string) {
    this.endpoint = normalizeWebDavUrl(endpoint);
    this.username = username.trim();
    this.appPassword = appPassword;
    if (!this.username || !this.appPassword) throw new Error("WebDAV 用户名和 App Password 不能为空");
  }

  async connect(): Promise<void> {
    let root = await this.request("PROPFIND", this.endpoint, { Depth: "0" });
    if (root.status === 404) {
      await this.request("MKCOL", this.endpoint);
      root = await this.request("PROPFIND", this.endpoint, { Depth: "0" });
    }
    if (![200, 207].includes(root.status)) throw this.errorForStatus(root.status);
    const objects = await this.request("MKCOL", new URL(OBJECTS_DIRECTORY, this.endpoint).toString());
    if (![201, 405, 409].includes(objects.status)) throw this.errorForStatus(objects.status);
  }

  async getManifest(): Promise<StoredObject | null> {
    return this.get("manifest");
  }

  async list(): Promise<StoredObjectMeta[]> {
    const response = await this.request("PROPFIND", new URL(OBJECTS_DIRECTORY, this.endpoint).toString(), { Depth: "1" });
    if (response.status === 404) return [];
    if (![200, 207].includes(response.status)) throw this.errorForStatus(response.status);
    const xml = await response.text();
    return parsePropfind(xml, this.endpoint);
  }

  async get(id: string): Promise<StoredObject | null> {
    const response = await this.request("GET", this.objectUrl(id));
    if (response.status === 404) return null;
    if (!response.ok) throw this.errorForStatus(response.status);
    const data = new Uint8Array(await response.arrayBuffer());
    const revision = response.headers.get("ETag");
    if (!revision) throw new WebDavCompatibilityError("WebDAV 服务器未返回 ETag");
    return { id, data, revision };
  }

  async put(id: string, data: Uint8Array, expectedRevision?: RevisionToken): Promise<StoredObjectMeta> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (expectedRevision) headers["If-Match"] = expectedRevision;
    else headers["If-None-Match"] = "*";
    const response = await this.request("PUT", this.objectUrl(id), headers, data);
    if (response.status === 409 || response.status === 412) throw new VaultConflictError();
    if (!response.ok) throw this.errorForStatus(response.status);
    const revision = response.headers.get("ETag");
    if (!revision) throw new WebDavCompatibilityError("WebDAV 服务器未返回 ETag");
    return { id, revision };
  }

  async delete(id: string, expectedRevision?: RevisionToken): Promise<void> {
    const headers: Record<string, string> = {};
    if (expectedRevision) headers["If-Match"] = expectedRevision;
    else headers["If-None-Match"] = "*";
    const response = await this.request("DELETE", this.objectUrl(id), headers);
    if (response.status === 404) return;
    if (response.status === 409 || response.status === 412) throw new VaultConflictError();
    if (!response.ok) throw this.errorForStatus(response.status);
  }

  private objectUrl(id: string): string {
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) throw new Error("Vault 对象 ID 无效");
    return new URL(`${OBJECTS_DIRECTORY}${encodeURIComponent(id)}.json`, this.endpoint).toString();
  }

  private async request(method: string, input: string, headers: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const requestHeaders = { ...headers, Authorization: this.authorizationHeader(), Accept: "application/json, application/xml" };
    const response = await fetchWithTimeout(input, { method, headers: requestHeaders, body: body ? body.slice().buffer as ArrayBuffer : undefined });
    if (response.status === 401) throw new Error("WebDAV 认证失败，请检查专用账号或 App Password");
    if (response.status === 403) throw new Error("WebDAV 权限不足，请检查目标目录权限");
    return response;
  }

  private authorizationHeader(): string {
    const bytes = new TextEncoder().encode(`${this.username}:${this.appPassword}`);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  private errorForStatus(status: number): Error {
    if (status >= 500) return new Error("WebDAV 服务器暂时不可用，请稍后重试");
    if (status === 405 || status === 501) return new WebDavCompatibilityError();
    return new Error(`WebDAV 请求失败（HTTP ${status}）`);
  }
}

function parsePropfind(xml: string, base: string): StoredObjectMeta[] {
  const results: StoredObjectMeta[] = [];
  const blocks = xml.match(/<(?:d:)?response\b[^>]*>[\s\S]*?<\/(?:d:)?response>/gi) ?? [];
  for (const block of blocks) {
    const href = tagValue(block, "href");
    const etag = tagValue(block, "getetag");
    if (!href || !etag) continue;
    try {
      const path = new URL(unescapeXml(href), base).pathname;
      const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (/^[A-Za-z0-9_-]{16,160}$/.test(id)) results.push({ id, revision: unescapeXml(etag) });
    } catch {
      // Ignore malformed directory members; they are not valid Vault objects.
    }
  }
  return results;
}

function tagValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<(?:(?:d|D):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:d|D):)?${tag}>`, "i"));
  return match?.[1]?.trim() || null;
}

function unescapeXml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}
