import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { SaveTwitterTokenInput } from "../dto/save-twitter-token.dto";
import {
  getTwitterRedirectUrl,
  saveTwitterToken,
} from "../services/twitter.service";

/**
 * Protected X (Twitter) OAuth-connect endpoints (Bearer token → APISIX injects
 * X-Userinfo). `authInterceptor` makes `userId` available to every handler
 * and rejects with 401 when the identity header is missing/invalid.
 *
 * The controller lives under `/x`; APISIX strips the `/shareability` gateway
 * prefix, so the public URLs are
 *   GET  /shareability/x/redirect-url
 *   POST /shareability/x/user-info
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["Twitter"], summary: "...", security: [{ bearerAuth: [] }] } })
 */
export const twitterController = authInterceptor(
  new Elysia({ prefix: "/x" })
)
  .get(
    "/redirect-url",
    async () => {
      // No input — just call the service and return its response.
      return await getTwitterRedirectUrl();
    },
    {
      detail: {
        tags: ["Twitter"],
        summary: "Get the X (Twitter) OAuth authorization URL (PKCE)",
        description:
          "Generates a fresh PKCE verifier + challenge and returns the X " +
          "authorization URL AND the verifier. The OAuth state IS the verifier. " +
          "Raw URL interpolation — nothing is encoded. The frontend performs " +
          "the actual redirect and must retain the verifier.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .post(
    "/user-info",
    async ({ body, userId, set }) => {
      // --- Locked payload assembly (spec §B1) — no `any` ---
      const b = (body ?? {}) as Partial<SaveTwitterTokenInput>;

      // Manual DTO validation (code + verifier required) — Nest-style 400.
      if (typeof b.code !== "string" || b.code.length === 0) {
        set.status = 400;
        return {
          statusCode: 400,
          message: ["code should not be empty"],
          error: "Bad Request",
        };
      }
      if (typeof b.verifier !== "string" || b.verifier.length === 0) {
        set.status = 400;
        return {
          statusCode: 400,
          message: ["verifier should not be empty"],
          error: "Bad Request",
        };
      }

      // userId is NOT trusted from body — overwritten with the auth user id.
      // `state` is ignored by the logic (kept for parity).
      // No logic here — just call the service and return its response.
      return await saveTwitterToken({
        code: b.code,
        verifier: b.verifier,
        state: b.state,
        userId,
      });
    },
    {
      body: t.Object(
        {
          code: t.Optional(t.String()),
          verifier: t.Optional(t.String()),
          state: t.Optional(t.String()),
        },
        { additionalProperties: true }
      ),
      detail: {
        tags: ["Twitter"],
        summary: "Save the X access token (PKCE OAuth code exchange)",
        description:
          "Exchanges the OAuth callback code + verifier for an X access token, " +
          "fetches the user profile (/2/users/me) and saves/updates the " +
          "connection under socialConnections.x in the social_connections " +
          "collection. The users document is never written.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
