/**
 * Typed DTO for POST /x/user-info — mirrors the webapi `TwitterUserInfoDTO` /
 * `TwitterService.saveTwitterToken(code, userId, verifier)` input (spec §B1).
 * NO `any` — all fields are typed.
 *
 * NOTE: `userId` is NOT trusted from the body — it is overwritten server-side
 * with the current authenticated user id (from X-Userinfo / auth context).
 * `state` is accepted for parity but is NEVER read by the logic.
 */
export interface SaveTwitterTokenInput {
  /** OAuth callback `code` from X (required, non-empty). */
  code: string;
  /** PKCE code_verifier issued by GET /x/redirect-url (required; == oauth state). */
  verifier: string;
  /** OAuth state — accepted but never read by the logic (parity only). */
  state?: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
