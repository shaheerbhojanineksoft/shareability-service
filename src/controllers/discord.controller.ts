import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { SaveDiscordTokenInput } from "../dto/save-discord-token.dto";
import {
  getDiscordChannelsByGuilds,
  getDiscordRedirectUrl,
  getDiscordUserAllGuilds,
  saveDiscordToken,
} from "../services/discord.service";

/**
 * Protected Discord endpoints (Bearer token → APISIX injects X-Userinfo).
 * `authInterceptor` makes `userId` available to every handler and rejects
 * with 401 when the identity header is missing/invalid.
 *
 * The controller lives under `/discord`; APISIX strips the `/shareability`
 * gateway prefix, so the public URLs are
 *   GET  /shareability/discord/redirect-url
 *   POST /shareability/discord/user-info
 *   GET  /shareability/discord/guilds
 *   GET  /shareability/discord/guild-channels?guilds=…
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["Discord"], summary: "...", security: [{ bearerAuth: [] }] } })
 *
 * NOTE: `/guild-channels` is the ONE discord route that does NOT read `userId`
 * (no userId is attached to its payload).
 */
export const discordController = authInterceptor(
  new Elysia({ prefix: "/discord" })
).get(
  "/guilds",
  async ({ userId }) => {
    // No input besides the auth userId — just call the service.
    return await getDiscordUserAllGuilds(userId);
  },
  {
    detail: {
      tags: ["Discord"],
      summary: "Get the user's postable Discord guilds",
      description:
        "Loads the stored Discord accessToken, fetches the guilds the user " +
        "can post to (ManageChannels + SendMessages), annotates each with a " +
        "connected flag (is the app bot present?) and persists them back to " +
        "social_connections. On a 401 the token is refreshed and retried once.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.get(
  "/guild-channels",
  async ({ query }) => {
    // --- Locked payload assembly (spec §2) — no `any` ---
    const q = query as Record<string, string | undefined>;
    const guilds = q.guilds;

    // No userId is attached for this endpoint. Missing/empty `guilds` passes
    // through (no 400 — the webapi @Query has no DTO pipe) and the service
    // returns `undefined` → empty HTTP body.
    return await getDiscordChannelsByGuilds({ guilds: guilds as string });
  },
  {
    query: t.Object(
      { guilds: t.Optional(t.String()) },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Discord"],
      summary: "Get text channels for selected Discord guilds",
      description:
        "For each guild in the JSON-stringified `guilds` array, fetches that " +
        "guild's TEXT channels (type === 0) from the Discord REST API as the " +
        "bot and returns one { guild, channels } entry per requested guild. " +
        "Pure read-only external fan-out — no DB read/write, no userId.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.get(
  "/redirect-url",
  async () => {
    // No input — just call the service and return its response.
    return await getDiscordRedirectUrl();
  },
  {
    detail: {
      tags: ["Discord"],
      summary: "Get the Discord OAuth authorization URL",
      description:
        "Builds the Discord authorization URL (client_id, hardcoded " +
        "redirect_uri = APP_URL + /callback/discord, response_type=code, " +
        "scope = 'identify guilds') with NO URL-encoding. The frontend performs " +
        "the actual redirect. No DB read/write.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.post(
  "/user-info",
  async ({ body, userId, set }) => {
    // --- Locked payload assembly (spec §B1) — no `any` ---
    const b = (body ?? {}) as Partial<SaveDiscordTokenInput>;

    // Manual DTO validation (code is required) — Nest-style 400.
    if (typeof b.code !== "string" || b.code.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["code should not be empty"],
        error: "Bad Request",
      };
    }

    // userId is NOT trusted from body — overwritten with the auth user id.
    // No logic here — just call the service and return its response.
    return await saveDiscordToken(b.code, userId);
  },
  {
    body: t.Object(
      { code: t.Optional(t.String()) },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Discord"],
      summary: "Save the Discord access token (OAuth code exchange)",
      description:
        "Exchanges the OAuth callback code for a Discord access token, fetches " +
        "the user profile (/users/@me) + postable guilds (bot-connected flag) " +
        "and saves/updates the connection under socialConnections.discord in " +
        "the social_connections collection. The users document is never written.",
      security: [{ bearerAuth: [] }],
    },
  }
);
