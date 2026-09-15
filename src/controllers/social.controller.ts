import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { SavePlatformInput } from "../dto/save-platform.dto";
import {
  disconnectSocialConnection,
  getHandles,
  savePlatform,
} from "../services/social.service";
import { connectGuildUrl } from "../services/discord.service";

/**
 * Protected social-verification endpoints (Bearer token → APISIX injects
 * X-Userinfo). `authInterceptor` makes `userId` available to every handler
 * and rejects with 401 when the identity header is missing/invalid.
 *
 * This controller has NO prefix — APISIX strips the `/shareability` gateway
 * prefix, so it hosts the top-level (no-prefix) shareability routes:
 *   GET /shareability/verify-username?platform=…&username=…
 *   GET /shareability/connect-guild?guildId=…
 *   GET /shareability/disconnect-platform?platform=…
 *   POST /shareability/save-handle
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["Social"], summary: "...", security: [{ bearerAuth: [] }] } })
 */
export const socialController = authInterceptor(new Elysia()).get(
  "/verify-username",
  async ({ query, set }) => {
    // --- Locked payload assembly (spec §2) — no `any` ---
    const q = query as Record<string, string | undefined>;
    const platform = q.platform;
    const username = q.username;

    // Manual DTO validation (platform + username required) — Nest-style 400.
    if (typeof platform !== "string" || platform.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["platform should not be empty"],
        error: "Bad Request",
      };
    }
    if (typeof username !== "string" || username.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["username should not be empty"],
        error: "Bad Request",
      };
    }

    // No logic here — just call the service and return its response.
    return await getHandles({ platform, username });
  },
  {
    query: t.Object(
      {
        platform: t.Optional(t.String()),
        username: t.Optional(t.String()),
      },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Social"],
      summary: "Verify a username exists on a social platform",
      description:
        "Validates a username as a public profile on facebook / linkedin / " +
        "x / reddit / instagram / telegram BEFORE connecting it. Response " +
        "data is a numeric status code (200/404/402/500). No DB write.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.get(
  "/connect-guild",
  async ({ query, set }) => {
    // --- Locked payload assembly (spec §2) — no `any` ---
    const q = query as Record<string, string | undefined>;
    const guildId = q.guildId;

    // Manual DTO validation (guildId required) — Nest-style 400.
    if (typeof guildId !== "string" || guildId.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["guildId should not be empty"],
        error: "Bad Request",
      };
    }

    // No logic here — just call the service and return its response.
    return await connectGuildUrl(guildId);
  },
  {
    query: t.Object(
      { guildId: t.Optional(t.String()) },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Discord"],
      summary: "Get a Discord bot-invite authorization URL for a guild",
      description:
        "Builds the Discord OAuth authorization URL scoped to a guild_id so " +
        "the user can invite the app's bot. Pure URL construction from env + " +
        "query — no DB read/write, no external call. The frontend does the " +
        "redirect.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.post(
  "/save-handle",
  async ({ body, userId, set }) => {
    // --- Locked payload assembly (spec §2) — no `any` ---
    const b = (body ?? {}) as Partial<SavePlatformInput>;

    // Manual DTO validation (platform / isValid / username required) — 400.
    if (typeof b.platform !== "string" || b.platform.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["platform should not be empty"],
        error: "Bad Request",
      };
    }
    if (typeof b.isValid !== "boolean") {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["isValid must be a boolean value"],
        error: "Bad Request",
      };
    }
    if (typeof b.username !== "string" || b.username.length === 0) {
      set.status = 400;
      return {
        statusCode: 400,
        message: ["username should not be empty"],
        error: "Bad Request",
      };
    }

    // userId is NOT trusted from body — overwritten with the auth user id.
    // No logic here — just call the service and return its response.
    return await savePlatform({
      platform: b.platform,
      isValid: b.isValid,
      username: b.username,
      userId,
    });
  },
  {
    body: t.Object(
      {
        platform: t.Optional(t.String()),
        isValid: t.Optional(t.Boolean()),
        username: t.Optional(t.String()),
      },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Social"],
      summary: "Save a verified social handle",
      description:
        "Persists the verify-username outcome into social_connections: " +
        "inserts a new doc when the user has none, else merges into the " +
        "existing one. No social-link notification is sent.",
      security: [{ bearerAuth: [] }],
    },
  }
)
.get(
  "/disconnect-platform",
  async ({ query, userId }) => {
    // --- Locked payload assembly (spec §2) — no `any` ---
    const q = query as Record<string, string | undefined>;
    const platform = q.platform;

    // NOTE: `platform` is NOT validated to a 400 here — the webapi passes
    // @Query through with no DTO pipe, so a missing platform reaches the
    // service guard and yields "Invalid Platform" (HTTP 200, isSuccess false).
    // Normalizing the missing query to "" is behaviourally identical: an
    // empty/unknown key also fails the `socialConnections[platform]` guard.
    // userId is NEVER trusted from the query — taken from the auth context.
    // No logic here — just call the service and return its response verbatim.
    return await disconnectSocialConnection({
      platform: platform ?? "",
      userId,
    });
  },
  {
    query: t.Object(
      { platform: t.Optional(t.String()) },
      { additionalProperties: true }
    ),
    detail: {
      tags: ["Social"],
      summary: "Disconnect a connected social platform",
      description:
        "Marks a previously-connected social platform as disconnected by " +
        "replacing socialConnections.<platform> with { status: \"disconnect\" } " +
        "(handle / account are dropped). Update only — an existing doc is " +
        "required. Response is the ResponseModel envelope verbatim.",
      security: [{ bearerAuth: [] }],
    },
  }
);
