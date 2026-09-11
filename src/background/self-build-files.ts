import { MAX_SELF_BUILD_FILE_SIZE, SELF_BUILD_STATIC_FILES } from "../shared/self-build-files";

const allowedFiles = new Set<string>(SELF_BUILD_STATIC_FILES);

export async function readSelfBuildFile(path: string): Promise<{ base64: string }> {
  if (!allowedFiles.has(path)) throw new Error("Self Build 文件清单无效");
  try {
    const response = await fetch(chrome.runtime.getURL(path), { cache: "no-store" });
    if (!response.ok) throw new Error("not ok");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SELF_BUILD_FILE_SIZE) throw new Error("file too large");
    return { base64: bytesToBase64(bytes) };
  } catch {
    throw new Error(`无法读取 ${path}`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
