import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { SaveFacebookTokenInput } from "../dto/save-facebook-token.dto";
import {
  getFacebookRedirectUrl,
  saveFacebookToken,
} from "../services/facebook.service";

/**
 * Protected Facebook OAuth-connect endpoints (Bearer token → APISIX injects
 * X-Userinfo). `authInterceptor` makes `userId` available to every handler
 * and rejects with 401 when the identity header is missing/invalid.
 *
 * The controller lives under `/facebook`; APISIX strips the `/shareability`
 * gateway prefix, so the public URLs are
 *   GET  /shareability/facebook/redirect-url
 *   POST /shareability/facebook/user-info
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["Facebook"], summary: "...", security: [{ bearerAuth: [] }] } })
 */
export const facebookController = authInterceptor(
  new Elysia({ prefix: "/facebook" })
)
  .get(
    "/redirect-url",
    async () => {
      // No input — just call the service and return its response.
      return await getFacebookRedirectUrl();
    },
    {
      detail: {
        tags: ["Facebook"],
        summary: "Get the Facebook OAuth authorization URL",
        description:
          "Builds the Facebook authorization URL (client_id / redirect_uri / " +
          "fresh state / scopes) with NO URL-encoding. The frontend performs " +
          "the actual redirect. No DB read/write.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .post(
    "/user-info",
    async ({ body, userId, set }) => {
      // --- Locked payload assembly (spec §B1) — no `any` ---
      const b = (body ?? {}) as Partial<SaveFacebookTokenInput>;

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
      return await saveFacebookToken(userId, b.code);
    },
    {
      body: t.Object(
        { code: t.Optional(t.String()) },
        { additionalProperties: true }
      ),
      detail: {
        tags: ["Facebook"],
        summary: "Save the Facebook access token (OAuth code exchange)",
        description:
          "Exchanges the OAuth callback code for a Facebook access token, " +
          "fetches the user profile (/v19.0/me) + pages (accounts) and " +
          "saves/updates the connection under socialConnections.facebook in " +
          "the social_connections collection. The users document is never " +
          "written.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
