import { unzipSync, zipSync } from "fflate";
import { RUNTIME_CONFIG_FILE, parseRuntimeConfig, type RuntimeConfig } from "../shared/runtime-config";
import { SELF_BUILD_STATIC_FILES, type SelfBuildFileResponse } from "../shared/self-build-files";
import { send } from "./bridge";
import {
  assertLocalNetworkPair,
  compareVersions,
  deriveNetworkVersion,
  normalizeVersion,
} from "../shared/version";

export const SELF_BUILD_CLICK_WINDOW_MS = 1_400;
export const SELF_BUILD_FILES_FILE = "self-build-files.json";

interface SelfBuildFilesManifest {
  version: 1;
  files: string[];
}

interface ManifestLike {
  version?: unknown;
  version_name?: unknown;
  key?: unknown;
  [key: string]: unknown;
}

export interface StaticFile {
  path: string;
  bytes: Uint8Array;
}

export interface AssembleDerivedBuildInput {
  files: readonly StaticFile[];
  fileManifest: unknown;
  currentManifest: unknown;
  runtimeManifestVersion: string;
  currentRuntimeConfig: unknown;
  targetLocalVersion: string;
  derivedBuildTime: string;
}

export interface DerivedBuildResult {
  archive: Uint8Array;
  targetLocalVersion: string;
  targetNetworkVersion: string;
  fileName: string;
}

let activeSelfBuild: Promise<DerivedBuildResult> | null = null;

export function formatSelfBuildTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function validateSelfBuildTarget(targetLocalVersion: string, currentLocalVersion: string): string {
  const target = normalizeVersion(targetLocalVersion);
  const current = normalizeVersion(currentLocalVersion);
  if (!target) throw new Error("目标版本格式无效");
  if (!current) throw new Error("当前本地版本格式无效");
  if (compareVersions(target, current) <= 0) throw new Error("自构建目标版本必须高于当前本地版本");
  return deriveNetworkVersion(target);
}

export function assembleDerivedBuild(input: AssembleDerivedBuildInput): DerivedBuildResult {
  const currentManifest = asManifest(input.currentManifest, "当前 manifest.json 格式无效");
  const runtimeManifestVersion = normalizeVersion(input.runtimeManifestVersion);
  const currentLocalVersion = normalizeVersion(currentManifest.version);
  if (!runtimeManifestVersion || !currentLocalVersion || runtimeManifestVersion !== currentLocalVersion) {
    throw new Error("当前 manifest 版本与运行时版本不一致");
  }
  if (typeof currentManifest.key !== "string" || !currentManifest.key) throw new Error("当前 manifest.key 缺失");

  const currentRuntimeConfig = parseRuntimeConfig(input.currentRuntimeConfig);
  if (!currentRuntimeConfig || !assertLocalNetworkPair(currentLocalVersion, currentRuntimeConfig.networkPluginVersion)) {
    throw new Error("当前 runtime-config 格式无效");
  }
  const targetLocalVersion = normalizeVersion(input.targetLocalVersion);
  if (!targetLocalVersion) throw new Error("目标版本格式无效");
  const targetNetworkVersion = validateSelfBuildTarget(targetLocalVersion, currentLocalVersion);
  if (!assertLocalNetworkPair(targetLocalVersion, targetNetworkVersion)) {
    throw new Error("目标版本关系无效");
  }
  if (!/^\d{6}-\d{4}$/.test(input.derivedBuildTime)) throw new Error("派生构建时间格式无效");

  const filesManifest = asSelfBuildFilesManifest(input.fileManifest);
  const staticFiles = new Map<string, Uint8Array>();
  for (const file of input.files) {
    if (!isSafeRuntimePath(file.path) || staticFiles.has(file.path)) throw new Error("Self Build 文件清单无效");
    staticFiles.set(file.path, file.bytes);
  }
  const expectedPaths = new Set(filesManifest.files);
  if (staticFiles.size !== expectedPaths.size || [...staticFiles.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error("Self Build 文件清单与 runtime artifact 不完整");
  }
  for (const required of ["manifest.json", RUNTIME_CONFIG_FILE, "credential-core.wasm", SELF_BUILD_FILES_FILE]) {
    if (!expectedPaths.has(required)) throw new Error(`Self Build 缺少 ${required}`);
  }

  const wasm = staticFiles.get("credential-core.wasm");
  if (!wasm || !hasWasmHeader(wasm)) throw new Error("无法读取 credential-core.wasm");
  const targetManifest: ManifestLike = { ...currentManifest, version: targetLocalVersion };
  targetManifest.version_name = `self-${input.derivedBuildTime}`;
  const targetRuntimeConfig: RuntimeConfig = { version: 1, networkPluginVersion: targetNetworkVersion };
  const archiveFiles: Record<string, Uint8Array> = {};
  for (const [path, bytes] of staticFiles) archiveFiles[path] = bytes;
  archiveFiles["manifest.json"] = encodeJson(targetManifest);
  archiveFiles[RUNTIME_CONFIG_FILE] = encodeJson(targetRuntimeConfig);

  const archive = zipSync(archiveFiles, { level: 0 });
  verifyDerivedArchive(archive, filesManifest, currentManifest.key, wasm, targetLocalVersion, targetNetworkVersion);
  return {
    archive,
    targetLocalVersion,
    targetNetworkVersion,
    fileName: `UniPass-${targetLocalVersion}.zip`,
  };
}

export function buildSelfDerivedBuild(targetLocalVersion: string): Promise<DerivedBuildResult> {
  if (activeSelfBuild) return activeSelfBuild;
  activeSelfBuild = buildSelfDerivedBuildOnce(targetLocalVersion).finally(() => {
    activeSelfBuild = null;
  });
  return activeSelfBuild;
}

async function buildSelfDerivedBuildOnce(targetLocalVersion: string): Promise<DerivedBuildResult> {
  const runtimeManifest = chrome.runtime.getManifest() as ManifestLike;
  const runtimeManifestVersion = normalizeVersion(runtimeManifest.version);
  if (!runtimeManifestVersion) throw new Error("当前本地版本格式无效");
  const fileManifest = await readSelfBuildFilesManifest();
  const fileList = fileManifest.files;
  const files = await Promise.all(fileList.map(async (path) => ({ path, bytes: await fetchBytes(path) })));
  const manifestBytes = requireFile(files, "manifest.json");
  const configBytes = requireFile(files, RUNTIME_CONFIG_FILE);
  const currentManifest = parseJson(manifestBytes, "当前 manifest.json 格式无效");
  const currentRuntimeConfig = parseJson(configBytes, "当前 runtime-config 格式无效");
  const result = assembleDerivedBuild({
    files,
    fileManifest,
    currentManifest,
    runtimeManifestVersion,
    currentRuntimeConfig,
    targetLocalVersion,
    derivedBuildTime: formatSelfBuildTime(new Date()),
  });
  downloadArchive(result.archive, result.fileName);
  return result;
}

export async function readSelfBuildFilesManifest(): Promise<SelfBuildFilesManifest> {
  try {
    return asSelfBuildFilesManifest(await fetchJson(SELF_BUILD_FILES_FILE));
  } catch (error) {
    // Builds made before the self-build manifest was added can still be upgraded
    // when all files from the fixed, audited artifact layout are present.
    if (error instanceof Error && error.message === `无法读取 ${SELF_BUILD_FILES_FILE}`) {
      return { version: 1, files: [...SELF_BUILD_STATIC_FILES] };
    }
    throw error;
  }
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  if (!isSafeRuntimePath(path)) throw new Error("Self Build 文件清单无效");
  try {
    const response = await send<SelfBuildFileResponse>({ type: "readSelfBuildFile", path });
    return base64ToBytes(response.base64);
  } catch {
    throw new Error(`无法读取 ${path}`);
  }
}

async function fetchJson(path: string): Promise<unknown> {
  return parseJson(await fetchBytes(path), `${path} 格式无效`);
}

function downloadArchive(archive: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([archive.slice().buffer as ArrayBuffer], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function verifyDerivedArchive(
  archive: Uint8Array,
  fileManifest: SelfBuildFilesManifest,
  currentKey: string,
  currentWasm: Uint8Array,
  targetLocalVersion: string,
  targetNetworkVersion: string,
): void {
  const entries = unzipSync(archive);
  const actualPaths = Object.keys(entries).sort();
  const expectedPaths = [...fileManifest.files].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("生成 ZIP 文件集合不完整");
  const manifest = asManifest(parseJson(entries["manifest.json"], "生成 manifest.json 格式无效"), "生成 manifest.json 格式无效");
  const config = parseRuntimeConfig(parseJson(entries[RUNTIME_CONFIG_FILE], "生成 runtime-config 格式无效"));
  if (manifest.version !== targetLocalVersion || manifest.key !== currentKey) throw new Error("生成 ZIP 的 manifest 校验失败");
  if (!config || config.networkPluginVersion !== targetNetworkVersion) throw new Error("生成 ZIP 的 runtime-config 校验失败");
  if (!sameBytes(entries["credential-core.wasm"], currentWasm)) throw new Error("生成 ZIP 的 WASM 与当前版本不一致");
  const generatedManifest = asSelfBuildFilesManifest(parseJson(entries[SELF_BUILD_FILES_FILE], "生成文件清单格式无效"));
  if (JSON.stringify(generatedManifest.files) !== JSON.stringify(fileManifest.files)) throw new Error("生成 ZIP 的文件清单校验失败");
}

function asManifest(value: unknown, message: string): ManifestLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as ManifestLike;
}

function asSelfBuildFilesManifest(value: unknown): SelfBuildFilesManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Self Build 文件清单格式无效");
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.files) || candidate.files.length === 0) {
    throw new Error("Self Build 文件清单格式无效");
  }
  const files = candidate.files.filter((file): file is string => typeof file === "string");
  if (files.length !== candidate.files.length || new Set(files).size !== files.length || files.some((file) => !isSafeRuntimePath(file))) {
    throw new Error("Self Build 文件清单格式无效");
  }
  return { version: 1, files };
}

function isSafeRuntimePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..") && !path.includes("\0");
}

function hasWasmHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d
    && bytes[4] === 0x01 && bytes[5] === 0x00 && bytes[6] === 0x00 && bytes[7] === 0x00;
}

function requireFile(files: readonly StaticFile[], path: string): Uint8Array {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`无法读取 ${path}`);
  return file.bytes;
}

function parseJson(bytes: Uint8Array, message: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(message);
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
