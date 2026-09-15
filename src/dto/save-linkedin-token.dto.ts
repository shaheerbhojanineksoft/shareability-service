/**
 * Typed DTO for POST /linkedin/user-info — mirrors the webapi
 * saveLinkedInToken() input (spec §B1). NO `any` — all fields are typed.
 *
 * NOTE: `userId` is NOT trusted from the body — it is overwritten server-side
 * with the current authenticated user id (from X-Userinfo / auth context).
 */
export interface SaveLinkedInTokenInput {
  /** OAuth callback `code` from LinkedIn (required, non-empty). */
  code: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
