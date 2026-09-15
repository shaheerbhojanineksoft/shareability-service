/**
 * Typed DTO for GET /disconnect-platform — mirrors the webapi
 * `ShareAbilityService.disconnectPlatform()` →
 * `SocialService.disconnectSocialConnection(userId, platform)` input (spec §2).
 * NO `any`.
 *
 * NOTE: `userId` is NEVER read from the query — it is injected server-side
 * from the auth context (X-Userinfo `sub`). The ONLY client-supplied field is
 * `platform`.
 */
export interface DisconnectPlatformInput {
  /** Dynamic key under socialConnections (e.g. facebook, linkedin, x…). */
  platform: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
