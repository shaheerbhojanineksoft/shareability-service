/** All env vars / constants used by the Shareability Service. */

/** Boolean env var — accepts true/false, 1/0, yes/no, on/off; blank ⇒ fallback. */
function parseBool(raw: string | undefined, fallback: boolean): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return fallback;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new Error(
    `[config] Environment variable must be a boolean (got "${raw}") — use true/false.`
  );
}

export const constants = {
  // --- Service ---
  SERVICE_NAME: "Shareability Service",

  // --- Auth mode (who verifies the user's token) ---
  // true  (DEFAULT, unchanged) → APISIX (openid-connect) verified the token and
  //         injects `X-Userinfo`: the protected routes only read that header.
  // false → no gateway in front: THIS service verifies the raw
  //         `Authorization: Bearer <token>` itself against Keycloak's JWKS
  //         (signature + `iss` + expiry) and takes the identity from the
  //         VERIFIED claims. `X-Userinfo` is IGNORED in this mode — trusting it
  //         would let any caller impersonate any user.
  // (Same flag/semantics as user-and-identity-service.)
  GATEWAY_AUTH_ENABLED: parseBool(process.env.GATEWAY_AUTH_ENABLED, true),
  // --- Keycloak issuer (only used when GATEWAY_AUTH_ENABLED=false) ---
  KEYCLOAK_BASE_URL: process.env.KEYCLOAK_BASE_URL ?? "",
  KEYCLOAK_REALM_NAME: process.env.KEYCLOAK_REALM_NAME ?? "",
  // Optional: explicit JWKS endpoint and extra accepted `iss` values
  // (comma separated). Blank ⇒ derived from the issuer above.
  KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL ?? "",
  KEYCLOAK_ISSUERS: process.env.KEYCLOAK_ISSUERS ?? "",
  // Tolerated clock skew (seconds) when verifying a Keycloak token locally.
  KEYCLOAK_CLOCK_TOLERANCE_SECONDS: Number(
    process.env.KEYCLOAK_CLOCK_TOLERANCE_SECONDS ?? 5
  ),

  // --- Mongo (single DB per service convention; jobs replicate collections) ---
  DATABASE_URL: process.env.DATABASE_URL ?? "mongodb://localhost:27017",
  // TODO: confirm the official DB name once the shareability spec arrives
  // (convention so far: Traderverse-Authentication / Traderverse-connections /
  // Traderverse-Market). This is a placeholder default.
  DATABASE_NAME: process.env.DATABASE_NAME ?? "Traderverse-Shareability",

  // --- LinkedIn OAuth connect ---
  // Only social_connections is written; the users doc is NEVER updated here.
  SOCIAL_CONNECTIONS_COLLECTION: "social_connections",
  LINKEDIN_ACCESS_TOKEN_URL: "https://www.linkedin.com/oauth/v2/accessToken",
  LINKEDIN_AUTH_URL:
    process.env.LINKEDIN_AUTH_URL ??
    "https://www.linkedin.com/oauth/v2/authorization",
  LINKEDIN_SCOPES: "openid profile email w_member_social",
  LINKEDIN_APP_API_KEY: process.env.LINKEDIN_APP_API_KEY ?? "",
  LINKEDIN_APP_SECRET_KEY: process.env.LINKEDIN_APP_SECRET_KEY ?? "",
  // redirect_uri is built by PLAIN concatenation: APP_URL + LINKEDIN_CALLBACK_URL
  APP_URL: process.env.APP_URL ?? "",
  LINKEDIN_CALLBACK_URL: process.env.LINKEDIN_CALLBACK_URL ?? "",

  // --- X (Twitter) OAuth connect (GET /x/redirect-url + POST /x/user-info) ---
  // PKCE S256 flow — verifier is issued in redirect-url, consumed in user-info.
  // Only social_connections is written; the users doc is NEVER updated here.
  TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID ?? "",
  TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET ?? "",
  // Authorization base URL (default XUrlsV2.OAUTH_AUTHORIZATION).
  TWITTER_AUTH_URL:
    process.env.TWITTER_AUTH_URL ?? "https://x.com/i/oauth2/authorize",
  // Token-exchange POST URL (default X OAuth2 token endpoint).
  TWITTER_GET_TOKEN_API:
    process.env.TWITTER_GET_TOKEN_API ?? "https://api.twitter.com/2/oauth2/token",
  // redirect_uri is built by PLAIN concatenation: APP_URL + TWITTER_CALLBACK_URL
  TWITTER_CALLBACK_URL: process.env.TWITTER_CALLBACK_URL ?? "",
  // User-profile fetch (XUrlsV2.ACCESS_TOKEN — the uppercase X.com is kept).
  X_URLS_V2_ACCESS_TOKEN: "https://api.X.com/2/users/me",

  // --- Telegram OAuth connect (GET /telegram/redirect-url + GET /telegram/user-info) ---
  // Bot token "<botId>:<secret>" — used BOTH as bot_id in the auth URL AND in
  // the Bot API getUpdates path. Only social_connections is written here.
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  // Authorization base URL (TelegramUrls.OAUTH_AUTHORIZATION).
  TELEGRAM_OAUTH_AUTHORIZATION_URL: "https://oauth.telegram.org/auth",
  // Bot API base — channels are pulled via /bot<token>/getUpdates.
  TELEGRAM_API_URL: "https://api.telegram.org",

  // --- Facebook OAuth connect (GET /facebook/redirect-url + POST /facebook/user-info) ---
  // Only social_connections is written; the users doc is NEVER updated here.
  FB_APP_ID: process.env.FB_APP_ID ?? "",
  FB_APP_SECRET: process.env.FB_APP_SECRET ?? "",
  // redirect_uri is built by PLAIN concatenation: APP_URL + FB_CALLBACK_URL
  FB_CALLBACK_URL: process.env.FB_CALLBACK_URL ?? "",
  // Authorization base URL (env — required).
  FB_AUTH_URL: process.env.FB_AUTH_URL ?? "",
  // Accounts endpoint (EXACT env name kept: Facebook_GET_ACCOUNTS).
  FB_GET_ACCOUNTS: process.env.Facebook_GET_ACCOUNTS ?? "",
  // User-profile fetch (FacebookUrls.USER_INFO).
  FB_USER_INFO_URL: "https://graph.facebook.com/v19.0/me",

  // --- Social username verification (GET /verify-username) ---
  // Env secrets used by the per-platform checkers.
  FACEBOOK_COOKIE_C_USER: process.env.FACEBOOK_COOKIE_C_USER ?? "",
  FACEBOOK_COOKIE_XS: process.env.FACEBOOK_COOKIE_XS ?? "",
  REDDIT_APP_ID: process.env.REDDIT_APP_ID ?? "",
  REDDIT_APP_SECRET: process.env.REDDIT_APP_SECRET ?? "",
  INSTAGRAM_USERNAME: process.env.INSTAGRAM_USERNAME ?? "",
  INSTAGRAM_PASSWORD: process.env.INSTAGRAM_PASSWORD ?? "",

  // SocialUrls base values (shareability-microservice constant.ts).
  SOCIAL_URLS: {
    facebook: "https://www.facebook.com",
    x: "https://www.x.com",
    reddit: "https://www.reddit.com/user", // base NOT used — reddit hits oauth.reddit.com
    linkedin: "https://www.linkedin.com/in",
    telegram: "https://t.me",
    instagram: "https://www.instagram.com",
  } as const,

  // --- Discord (GET /discord/guilds + GET /connect-guild + GET /guild-channels) ---
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? "",
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? "",
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET ?? "",
  DISCORD_CALLBACK_URL: process.env.DISCORD_CALLBACK_URL ?? "",
  // Integer permission bitfield for the bot invite (parsed with parseInt).
  DISCORD_PERMISSION: process.env.DISCORD_PERMISSION ?? "",
  DISCORD_USER_GUILDS_URL: "https://discord.com/api/users/@me/guilds",
  // Base for GET /guilds/<id>/channels (DiscordUrls.USER_GUILD_CHANNELS).
  DISCORD_USER_GUILD_CHANNELS_URL: "https://discord.com/api/v10/guilds",
  // User profile fetch (DiscordUrls.USER_INFO).
  DISCORD_USER_INFO_URL: "https://discord.com/api/users/@me",
  DISCORD_ACCESS_TOKEN_URL: "https://discord.com/api/oauth2/token",
  DISCORD_OAUTH_AUTHORIZATION_URL: "https://discord.com/oauth2/authorize",
} as const;
