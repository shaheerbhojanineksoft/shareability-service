/**
 * Typed DTO for GET /verify-username — mirrors the webapi
 * getHandles(platform, username) input (spec §2). NO `any`.
 *
 * NOTE: `userId` is attached from the auth context for parity but is NEVER
 * read by the verify logic (dead field — see spec quirk #6).
 */
export interface VerifyUsernameInput {
  /** One of: facebook, linkedin, x, reddit, instagram, telegram. */
  platform: string;
  /** Public handle to verify (interpolated as-is, no trimming/encoding). */
  username: string;
  /** Auth user id — unused by the logic (kept for parity). */
  userId?: string;
}
