import runtimeArtifactFiles from "./runtime-artifact-files.json";

export const SELF_BUILD_STATIC_FILES = Object.freeze(runtimeArtifactFiles);
export const MAX_SELF_BUILD_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_SELF_BUILD_TOTAL_SIZE = 50 * 1024 * 1024;

export interface SelfBuildFileResponse {
  base64: string;
}
