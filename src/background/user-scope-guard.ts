import { currentUser } from "../shared/api";
import { requireStableUserScope, userScopeFor } from "../shared/user-scope";

export class UserScopeMismatchError extends Error {}

export async function withUserScope<T>(
  userScope: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const scope = requireStableUserScope(userScope);
  await assertCurrentUserScope(scope);
  const result = await operation();
  await assertCurrentUserScope(scope);
  return result;
}

export async function assertCurrentUserScope(expectedScope: string): Promise<void> {
  const actualScope = userScopeFor(await currentUser());
  if (!actualScope) throw new UserScopeMismatchError("UniPass 会话缺少稳定用户标识");
  if (actualScope !== expectedScope.trim()) {
    throw new UserScopeMismatchError("UniPass 用户已切换，请重新打开弹窗");
  }
}
