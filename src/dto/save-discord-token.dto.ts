/**
 * Typed DTO for POST /discord/user-info — mirrors the webapi `UserInfoDTO` /
 * `DiscordService.saveDiscordToken(code, userId)` input (spec §B1). NO `any`.
 *
 * NOTE: `userId` is NOT trusted from the body — it is overwritten server-side
 * with the current authenticated user id (from X-Userinfo / auth context).
 */
export interface SaveDiscordTokenInput {
  /** OAuth callback `code` from Discord (required, non-empty). */
  code: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
