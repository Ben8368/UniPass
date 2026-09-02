import type { BackgroundRequest, BackgroundResponse } from "../shared/types";

export async function send<T>(message: BackgroundRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<BackgroundRequest, BackgroundResponse<T>>(message);
  if (!response?.ok) throw new Error(response?.error || "扩展后台没有响应");
  return response.data;
}
