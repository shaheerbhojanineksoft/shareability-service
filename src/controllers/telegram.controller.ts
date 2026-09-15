import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { GetTelegramUserInfoInput } from "../dto/get-telegram-user-info.dto";
import {
  getTelegramRedirectUrl,
  getTelegramUserInfo,
} from "../services/telegram.service";

/**
 * Protected Telegram OAuth-connect endpoints (Bearer token → APISIX injects
 * X-Userinfo). `authInterceptor` makes `userId` available to every handler
 * and rejects with 401 when the identity header is missing/invalid.
 *
 * The controller lives under `/telegram`; APISIX strips the `/shareability`
 * gateway prefix, so the public URLs are
 *   GET /shareability/telegram/redirect-url
 *   GET /shareability/telegram/user-info?code=…
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["Telegram"], summary: "...", security: [{ bearerAuth: [] }] } })
 */
export const telegramController = authInterceptor(
  new Elysia({ prefix: "/telegram" })
)
  .get(
    "/redirect-url",
    async () => {
      // No input — just call the service and return its response.
      return await getTelegramRedirectUrl();
    },
    {
      detail: {
        tags: ["Telegram"],
        summary: "Get the Telegram Login Widget authorization URL",
        description:
          "Builds the Telegram oauth.telegram.org/auth URL (bot_id = the full " +
          "bot token, only `origin` is URL-encoded, request_access=write). The " +
          "frontend opens it — no redirect is performed here. No DB read/write.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .get(
    "/user-info",
    async ({ query, userId }) => {
      // --- Locked payload assembly (spec §B1) — no `any` ---
      const q = query as Record<string, string | undefined>;
      const code = q.code;

      // NOTE: no manual 400 for a missing `code` — the webapi passes
      // @Query("code") through with no DTO pipe, so an absent code reaches the
      // service and surfaces as the outer-catch error envelope (HTTP 200).
      // userId is NEVER read from the query — taken from the auth context.
      // No logic here — just call the service and return its response.
      return await getTelegramUserInfo({
        token: code as string,
        userId,
      });
    },
    {
      query: t.Object(
        { code: t.Optional(t.String()) },
        { additionalProperties: true }
      ),
      detail: {
        tags: ["Telegram"],
        summary: "Save the Telegram connection from the widget code",
        description:
          "Decodes the Telegram Login Widget return code (base64url-encoded " +
          "JSON user blob — decoded, NOT signature-verified), pulls the bot's " +
          "channels and saves/updates the connection under " +
          "socialConnections.telegram in the social_connections collection. " +
          "The users document is never written.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
