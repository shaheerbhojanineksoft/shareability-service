/**
 * Typed DTO for GET /telegram/user-info — mirrors the webapi
 * `getTelegramUserInfo()` → `TelegramService.getUserData(token, userId)` input
 * (spec §B1). NO `any`.
 *
 * NOTE: `userId` is NEVER read from the query — it is injected server-side
 * from the auth context (X-Userinfo `sub`). The ONLY client-supplied field is
 * the `code` query param (which becomes `token`).
 */
export interface GetTelegramUserInfoInput {
  /** Telegram widget return value — base64url-encoded JSON user blob. */
  token: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
