import { Elysia, t } from "elysia";

import { authInterceptor } from "../interceptors/auth.interceptor";
import type { SaveLinkedInTokenInput } from "../dto/save-linkedin-token.dto";
import {
  getLinkedinRedirectUrl,
  saveLinkedinToken,
} from "../services/linkedin.service";

/**
 * Protected LinkedIn-connect endpoints (Bearer token → APISIX injects
 * X-Userinfo). `authInterceptor` makes `userId` available to every handler
 * and rejects with 401 when the identity header is missing/invalid.
 *
 * The controller lives under `/linkedin`; APISIX strips the `/shareability`
 * gateway prefix, so the public URLs are
 *   GET  /shareability/linkedin/redirect-url
 *   POST /shareability/linkedin/user-info
 *
 * HOW TO ADD A PROTECTED ENDPOINT HERE:
 *   .get("/foo", async ({ userId }) => ...,
 *        { detail: { tags: ["LinkedIn"], summary: "...", security: [{ bearerAuth: [] }] } })
 */
export const linkedinController = authInterceptor(
  new Elysia({ prefix: "/linkedin" })
)
  .get(
    "/redirect-url",
    async () => {
      // No input — just call the service and return its response.
      return await getLinkedinRedirectUrl();
    },
    {
      detail: {
        tags: ["LinkedIn"],
        summary: "Get the LinkedIn OAuth authorization URL",
        description:
          "Returns the LinkedIn authorization URL (response_type=code) with " +
          "redirect_uri encoded. The frontend performs the actual redirect.",
        security: [{ bearerAuth: [] }],
      },
    }
  )
  .post(
    "/user-info",
    async ({ body, userId, set }) => {
      // --- Locked payload assembly (spec §B1) — no `any` ---
      const b = (body ?? {}) as Partial<SaveLinkedInTokenInput>;

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
      return await saveLinkedinToken(userId, b.code);
    },
    {
      body: t.Object(
        { code: t.Optional(t.String()) },
        { additionalProperties: true }
      ),
      detail: {
        tags: ["LinkedIn"],
        summary: "Save the LinkedIn access token (OAuth code exchange)",
        description:
          "Exchanges the OAuth callback code for a LinkedIn access token, " +
          "decodes the id_token profile and saves/updates the connection in " +
          "the social_connections collection.",
        security: [{ bearerAuth: [] }],
      },
    }
  );
