/**
 * Typed DTO for POST /facebook/user-info — mirrors the webapi `UserInfoDTO` /
 * `FacebookService.saveFacebookToken(userId, code)` input (spec §B1). NO `any`.
 *
 * NOTE: `userId` is NOT trusted from the body — it is overwritten server-side
 * with the current authenticated user id (from X-Userinfo / auth context).
 * Facebook's flow only carries `code` (no PKCE verifier).
 */
export interface SaveFacebookTokenInput {
  /** OAuth callback `code` from Facebook (required, non-empty). */
  code: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
