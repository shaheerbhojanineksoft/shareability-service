/**
 * Typed DTO for POST /save-handle — mirrors the webapi SavePlatFormDTO /
 * `SocialService.savePlatform(data)` input (spec §2). NO `any`.
 *
 * NOTE: `userId` is NOT trusted from the body — it is overwritten server-side
 * with the current authenticated user id (auth context).
 */
export interface SavePlatformInput {
  /** Platform name used as the dynamic key under socialConnections. */
  platform: string;
  /** Drives handle.validate: truthy → "isValid", else → "isInvalid". */
  isValid: boolean;
  /** Handle username (stored with `|| ""` fallback). */
  username: string;
  /** Current authenticated user id (server-set, from auth context). */
  userId: string;
}
