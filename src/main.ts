import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { healthController } from "./controllers/health.controller";
import { linkedinController } from "./controllers/linkedin.controller";
import { socialController } from "./controllers/social.controller";
import { discordController } from "./controllers/discord.controller";
import { twitterController } from "./controllers/twitter.controller";
import { telegramController } from "./controllers/telegram.controller";
import { facebookController } from "./controllers/facebook.controller";

/**
 * Main application assembly (like app.js / main.ts in Node.js).
 *
 * CONVENTION — every API lives in a controller under src/controllers/:
 *   - public endpoints   → plain Elysia instance (health)
 *   - protected endpoints → wrapped with authInterceptor (future)
 * Each controller uses ONE prefix, documents every route with Swagger
 * `detail` (tags + summary), and delegates logic to src/services/.
 */
export const app = new Elysia()
  .use(
    swagger({
      path: "/swagger",
      // Use the classic Swagger UI (like typical Node.js projects)
      // instead of the default Scalar UI.
      provider: "swagger-ui",
      documentation: {
        info: {
          title: "Shareability Service",
          version: "1.0.0",
          description:
            "API documentation for the Shareability Service. Swagger UI is available at /swagger and the OpenAPI JSON spec at /swagger/json.",
        },
        tags: [
          {
            name: "Health",
            description: "Service health checks",
          },
          {
            name: "LinkedIn",
            description: "LinkedIn platform-connect endpoints (Bearer token required)",
          },
          {
            name: "Social",
            description: "Multi-platform username verification (Bearer token required)",
          },
          {
            name: "Discord",
            description: "Discord platform-connect endpoints (Bearer token required)",
          },
          {
            name: "Twitter",
            description: "X (Twitter) OAuth platform-connect endpoints (Bearer token required)",
          },
          {
            name: "Telegram",
            description: "Telegram platform-connect endpoints (Bearer token required)",
          },
          {
            name: "Facebook",
            description: "Facebook platform-connect endpoints (Bearer token required)",
          },
        ],
        // Make Swagger UI's "Try it out" go through the APISIX gateway
        // (the service only trusts APISIX-injected X-Userinfo, not raw JWTs).
        // AUTH MODE (env `GATEWAY_AUTH_ENABLED`):
        //   true  (default) → APISIX validates the token and injects X-Userinfo;
        //                     protected routes read that header.
        //   false           → no gateway: this service verifies the raw Bearer
        //                     token itself (Keycloak JWKS) and takes the user
        //                     from the verified claims.
        servers: [
          {
            url: "http://localhost:9080/shareability",
            description: "APISIX Gateway (register as an upstream when ready)",
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description:
                "Keycloak access token. Click the Authorize (lock) button and paste your Bearer token.",
            },
          },
        },
      },
    })
  )
  .get("/", () => ({
    message: "Shareability Service is running 🚀",
    docs: "/swagger",
    openapi: "/swagger/json",
  }))
  .use(healthController) // public
  .use(linkedinController) // protected (openid-connect + interceptor)
  .use(socialController) // protected (openid-connect + interceptor)
  .use(discordController) // protected (openid-connect + interceptor)
  .use(twitterController) // protected (openid-connect + interceptor)
  .use(telegramController) // protected (openid-connect + interceptor)
  .use(facebookController) // protected (openid-connect + interceptor)
  .onError(({ code, set, error }) => {
    // Keep framework validation failures as HTTP 400 (Nest-style) instead of
    // Elysia's default 422 so Swagger Try-it-out behaves like the source API.
    if (code === "VALIDATION") {
      const err = error as { summary?: string; message?: string };
      const reason = err?.summary ?? err?.message ?? "Bad Request";
      set.status = 400;
      return {
        statusCode: 400,
        message: [reason],
        error: "Bad Request",
      };
    }
  });

export type App = typeof app;
