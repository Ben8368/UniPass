const REQUEST_TIMEOUT_MS = 12_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("网络请求超时，请稍后重试");
    if (error instanceof Error) throw new Error("网络请求失败，请稍后重试");
    throw new Error("网络请求失败，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; body: T | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error;
      return null;
    }) as T | null;
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("网络请求超时，请稍后重试");
    throw new Error("网络请求失败，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }
}
