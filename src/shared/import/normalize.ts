import { parseCsv } from "./csv";

export interface BrowserPasswordImportRecord {
  name?: string;
  url: string;
  username: string;
  password: string;
}

export interface NormalizedBrowserPasswordImportRecord extends BrowserPasswordImportRecord {
  line: number;
  target: { scheme: "https"; host: string; pathPrefix?: string };
  duplicateKey: string;
}

export interface BrowserCsvParseResult {
  records: NormalizedBrowserPasswordImportRecord[];
  invalid: number;
}

const SUPPORTED_HEADERS = new Set(["name", "url", "username", "password"]);

/** Converts browser CSV exports into the Vault's HTTPS-only target model. */
export function parseBrowserPasswordCsv(text: string): BrowserCsvParseResult {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error("CSV is missing a header row");
  const columns = new Map<string, number>();
  header.values.forEach((value, index) => {
    const key = value.replace(/^\uFEFF/, "").trim().toLowerCase();
    if (!key || !SUPPORTED_HEADERS.has(key)) return;
    if (columns.has(key)) throw new Error(`CSV has a duplicate ${key} header`);
    columns.set(key, index);
  });
  for (const required of ["url", "username", "password"]) {
    if (!columns.has(required)) throw new Error("CSV must include url, username, and password columns");
  }

  const records: NormalizedBrowserPasswordImportRecord[] = [];
  let invalid = 0;
  for (const row of rows) {
    if (row.values.every((value) => !value)) continue;
    const normalized = normalizeBrowserPasswordRecord({
      name: columns.has("name") ? row.values[columns.get("name")!] ?? "" : undefined,
      url: row.values[columns.get("url")!] ?? "",
      username: row.values[columns.get("username")!] ?? "",
      password: row.values[columns.get("password")!] ?? "",
    }, row.line);
    if (normalized) records.push(normalized); else invalid += 1;
  }
  return { records, invalid };
}

export function normalizeBrowserPasswordRecord(record: BrowserPasswordImportRecord, line = 0): NormalizedBrowserPasswordImportRecord | null {
  let url: URL;
  try { url = new URL(record.url.trim()); } catch { return null; }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const path = normalizedPath(url.pathname);
  // Vault fill is intentionally HTTPS-only. Imported HTTP records are retained
  // under their host but can never make HTTP a fill target.
  const target = { scheme: "https" as const, host, ...(path !== "/" && { pathPrefix: path }) };
  const name = record.name?.trim();
  return {
    ...(name && { name }),
    url: url.toString(),
    username: record.username,
    password: record.password,
    line,
    target,
    duplicateKey: `${target.scheme}://${host}${path}\u0000${record.username}`,
  };
}

export function importDisplayName(record: NormalizedBrowserPasswordImportRecord): string {
  return record.name?.trim() || record.target.host || `${record.target.scheme}://${record.target.host}`;
}

function normalizedPath(value: string): string {
  const path = value.replace(/\/+$/, "");
  return path || "/";
}
