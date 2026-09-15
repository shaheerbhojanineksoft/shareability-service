/**
 * Typed DTO for GET /discord/guild-channels — mirrors the webapi
 * `getDiscordChannelsByGuilds()` →
 * `DiscordService.getDiscordChannelsByGuilds(guilds)` input (spec §2). NO `any`.
 *
 * NOTE: no `userId` is attached for this endpoint (differs from most other
 * shareability endpoints). The payload is ONLY the raw `guilds` query string.
 */
export interface GetDiscordChannelsByGuildsInput {
  /**
   * JSON-stringified array of guild objects, e.g.
   * '[{"id":"123","name":"..."}, ...]'. Only each element's `id` is used to
   * build the Discord URL; the rest is echoed back in the response.
   */
  guilds: string;
}
