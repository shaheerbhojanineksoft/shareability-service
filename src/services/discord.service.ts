import axios from "axios";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";

import { constants } from "../config/constants";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";
import type { GetDiscordChannelsByGuildsInput } from "../dto/get-discord-channels-by-guilds.dto";

/** Response envelope (mirrors getResponseObject(isSuccess, message, data)). */
export interface DiscordGuildsEnvelope {
  isSuccess: boolean;
  data: any[] | undefined;
  message: string | undefined;
}

/**
 * GET /discord/guilds — behaviourally identical to the webapi
 * `DiscordService.getDiscordUserAllGuilds(userId)`.
 *
 * Loads the stored Discord accessToken, fetches the user's postable guilds
 * (permission-filtered), marks each with `connected` (is the bot present?),
 * saves them back to `social_connections`, and on a 401 refreshes the token
 * then RECURSES once.
 *
 * ⚠️ LOCKED: success message typo "Sucess" (missing c). `users` collection is
 * never touched. No notification / NATS / cron.
 */
export async function getDiscordUserAllGuilds(
  userId: string
): Promise<DiscordGuildsEnvelope> {
  try {
    // Step 1 — load the connection ({} when no doc exists).
    const connection: any = await getSocialConnections(userId);
    const accessToken =
      connection?.socialConnections?.discord?.account?.accessToken;

    // Step 2 — bot guilds + user's postable guilds (with connected flag).
    const response: any = await getUserActiveGuilds(accessToken);

    // Step 3 — success: persist guilds, then return them.
    if (response?.success) {
      connection.socialConnections.discord.account = {
        ...connection.socialConnections.discord.account,
        guilds: response?.guilds,
      };
      await updateConnection(connection._id as string, connection);
      // ⚠️ typo "Sucess" is preserved.
      return { isSuccess: true, data: response?.guilds, message: "Sucess" };
    }

    // Step 4 — 401 → refresh the token, save it, then recurse once.
    if (response?.status == 401) {
      const refreshToken =
        connection?.socialConnections?.discord?.account?.refresh_token;
      const refreshResponse: any = await getDiscordAccessToken(
        undefined,
        refreshToken
      );

      if (refreshResponse?.success) {
        const data = refreshResponse.data;
        connection.socialConnections.discord.account = {
          ...connection.socialConnections.discord.account,
          accessToken: data?.access_token,
          expireIn: data?.expires_in,
          scopes: data?.scope,
          refresh_token: data?.refresh_token,
        };
        await updateConnection(connection._id as string, connection);
        // ⚠️ RECURSION — re-reads the connection and retries.
        return await getDiscordUserAllGuilds(userId);
      }
    }

    // Non-success non-401 (or refresh not attempted / failed).
    return { isSuccess: false, data: undefined, message: response?.error };
  } catch (error: any) {
    // Step 5 — outer catch.
    return {
      isSuccess: false,
      data: undefined,
      message: error?.response?.data?.error,
    };
  }
}

/**
 * SocialService.getSocialConnections(userId) equivalent:
 * `{ ...socialConnections[0] }` → `{}` when no doc exists.
 */
async function getSocialConnections(userId: string): Promise<any> {
  const docs = await findByQuery({ userId });
  return docs && docs.length > 0 ? { ...docs[0] } : {};
}

/**
 * getUserActiveGuilds(accessToken):
 *  - fresh discord.js bot login per request (guilds.cache right after login)
 *  - delegates to getUserPostableGuilds
 *  - failure shapes:
 *      error?.response?.data?.code set →
 *        { success:false, error:"An error occured getting discord guilds.", message: <code> }
 *      otherwise →
 *        { success:false, message: error?.response?.data?.error, status: error?.status }
 */
async function getUserActiveGuilds(accessToken: string): Promise<any> {
  try {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(constants.DISCORD_BOT_TOKEN);
    // Right after login (no explicit ready wait) — replicate as-is.
    const guildIds = client.guilds.cache.map((g) => g.id);
    // Clean up the per-request client (spec allows equivalent cleanup).
    await client.destroy().catch(() => {});

    return await getUserPostableGuilds(accessToken, guildIds);
  } catch (error: any) {
    if (error?.response?.data?.code) {
      return {
        success: false,
        error: "An error occured getting discord guilds.",
        message: error?.response?.data?.code,
      };
    }
    return {
      success: false,
      message: error?.response?.data?.error,
      status: error?.status,
    };
  }
}

/**
 * getUserPostableGuilds — GET /users/@me/guilds (Bearer user token) then keep
 * only guilds whose permissions include ManageChannels AND SendMessages.
 * No try/catch — errors propagate to getUserActiveGuilds.
 */
async function getUserPostableGuilds(
  accessToken: string,
  guildIds: string[]
): Promise<{ guilds: any[]; success: boolean }> {
  const res = await axios.get(constants.DISCORD_USER_GUILDS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const guilds: any[] = Array.isArray(res.data) ? res.data : [];
  const updatedGuilds = guilds
    .filter((g: any) => {
      if (!g?.permissions) return false; // no permissions → excluded
      const perms = new PermissionsBitField(BigInt(g.permissions));
      return (
        perms.has(PermissionsBitField.Flags.ManageChannels) &&
        perms.has(PermissionsBitField.Flags.SendMessages)
      );
    })
    .map((g: any) =>
      guildIds.includes(g.id) ? { ...g, connected: true } : { ...g, connected: false }
    );

  return { guilds: updatedGuilds || [], success: true };
}

/**
 * getDiscordAccessToken(code?, refreshToken?) — refresh helper.
 * code given → grant_type=authorization_code; else grant_type=refresh_token.
 * Success → { success:true, data }; failure → error-shape object.
 */
async function getDiscordAccessToken(
  code?: string,
  refreshToken?: string
): Promise<any> {
  try {
    const redirectUri = constants.APP_URL + constants.DISCORD_CALLBACK_URL;
    const params: Record<string, string> = {
      redirect_uri: redirectUri,
      client_id: constants.DISCORD_CLIENT_ID,
      client_secret: constants.DISCORD_CLIENT_SECRET,
    };
    if (code) {
      params.grant_type = "authorization_code";
      params.code = code;
    } else {
      params.grant_type = "refresh_token";
      params.refresh_token = refreshToken ?? "";
    }

    const res = await axios.post(
      constants.DISCORD_ACCESS_TOKEN_URL,
      new URLSearchParams(params).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return { success: true, data: res.data };
  } catch (error: any) {
    if (error?.response?.data?.code) {
      return {
        success: false,
        error: "An error occured getting discord user information.",
        message: error?.response?.data?.code,
      };
    }
    return { success: false, error: error?.response?.data?.error };
  }
}

/** Envelope for GET /connect-guild. */
export interface ConnectGuildEnvelope {
  isSuccess: boolean;
  data: string | undefined;
  message: string;
}

/**
 * GET /connect-guild — behaviourally identical to the webapi
 * `ShareAbilityService.connectGuild()` → `DiscordService.connectGuildUrl()`.
 *
 * Builds a Discord OAuth authorization URL scoped to a guild (bot invite).
 * Pure URL construction — NO DB read/write, NO external call.
 *
 * ⚠️ LOCKED quirks:
 *  - success message = "" (empty string, NOT "Success")
 *  - redirectUri = APP_URL + "/callback/discord" (HARDCODED path)
 *  - scopes = "guilds bot applications.commands" (raw spaces)
 *  - permissions = parseInt(DISCORD_PERMISSION)
 *  - redirect_uri / scopes / guildId are NOT URL-encoded
 */
export async function connectGuildUrl(
  guildId: string
): Promise<ConnectGuildEnvelope> {
  try {
    const clientId = constants.DISCORD_CLIENT_ID;
    const redirectUri = constants.APP_URL + "/callback/discord";
    const scopes = "guilds bot applications.commands";
    const permissions = parseInt(constants.DISCORD_PERMISSION, 10);

    const url =
      constants.DISCORD_OAUTH_AUTHORIZATION_URL +
      "?client_id=" +
      clientId +
      "&redirect_uri=" +
      redirectUri +
      "&response_type=code" +
      "&scope=" +
      scopes +
      "&permissions=" +
      permissions +
      "&guild_id=" +
      guildId;

    return { isSuccess: true, data: url, message: "" };
  } catch {
    return { isSuccess: false, data: undefined, message: "Something went wrong" };
  }
}

/** Envelope for GET /guild-channels. */
export interface GetDiscordChannelsByGuildsEnvelope {
  isSuccess: boolean;
  data?: unknown;
  message: string;
}

/**
 * GET /guild-channels — behaviourally identical to the webapi
 * `ShareAbilityService.getDiscordChannelsByGuilds()` →
 * `DiscordService.getDiscordChannelsByGuilds(guilds)`.
 *
 * For each user-picked guild (passed as a JSON-stringified array), fetches that
 * guild's TEXT channels (type === 0) from the Discord REST API authenticated
 * as the BOT and returns one `{ guild, channels }` entry per requested guild.
 * Pure read-only external fan-out (Promise.all) — NO Mongo read/write, no
 * `userId` is attached/used for this endpoint.
 *
 * ⚠️ LOCKED quirks:
 *  - success message "Success"; catch message "something went wrong" (lowercase)
 *  - missing/falsy `guilds` → returns `undefined` (NO envelope → empty body)
 *  - catch `data` = the RAW thrown error (object / SyntaxError)
 *  - `getDiscordChannelsByGuild` THROWS on axios error (does not swallow) → a
 *    single bad guild fails the whole Promise.all (no partial success)
 *  - only `guild.id` is consumed; the full guild object is echoed back
 */
export async function getDiscordChannelsByGuilds(
  data: GetDiscordChannelsByGuildsInput
): Promise<GetDiscordChannelsByGuildsEnvelope | undefined> {
  try {
    if (data.guilds) {
      const parsedGuilds = JSON.parse(data.guilds) as Array<Record<string, any>>;
      // Parallel fan-out — one HTTP call per guild.
      const responses = await Promise.all(
        parsedGuilds.map((guild) => getDiscordChannelsByGuild(guild))
      );
      return { isSuccess: true, data: responses, message: "Success" };
    }
    // `guilds` falsy → fall through → return undefined (no envelope).
    return undefined;
  } catch (error) {
    // data = the raw thrown error (a thrown { success:false, … } or SyntaxError).
    return { isSuccess: false, data: error, message: "something went wrong" };
  }
}

/**
 * getDiscordChannelsByGuild(guild) — GET the guild's channels (BOT auth) and
 * keep only TEXT channels (type === 0). A falsy `guild` returns `false` (not
 * thrown) — only reachable if an array element is falsy.
 *
 * ⚠️ THROWS on axios failure (does NOT return an error envelope):
 *   with error.response.data.code →
 *     throw { success: false, error: "An error occured getting discord channels.", message: <code> }
 *     (typo "occured" preserved)
 *   otherwise → throw { error: error.response?.data, success: false }
 */
async function getDiscordChannelsByGuild(
  guild: Record<string, any>
): Promise<any> {
  try {
    if (guild) {
      const res = await axios.get(
        `${constants.DISCORD_USER_GUILD_CHANNELS_URL}/${guild?.id}/channels`,
        { headers: { Authorization: `Bot ${constants.DISCORD_BOT_TOKEN}` } }
      );
      // Keep TEXT channels only (announcement/category/voice are dropped).
      const channels = (res.data as any[]).filter((c: any) => c.type === 0);
      return { guild, channels };
    }
    return false;
  } catch (error: any) {
    if (error?.response?.data?.code) {
      throw {
        success: false,
        error: "An error occured getting discord channels.",
        message: error?.response?.data?.code,
      };
    }
    throw { error: error?.response?.data, success: false };
  }
}

/** Envelope for GET /discord/redirect-url (data = a URL STRING, message ""). */
export interface DiscordRedirectUrlEnvelope {
  isSuccess: boolean;
  data: string;
  message: string;
}

/**
 * GET /discord/redirect-url — behaviourally identical to the webapi
 * `ShareAbilityService.getDiscordRedirectUrl()` →
 * `DiscordService.getDiscordRedirectUrl()`.
 *
 * Builds the Discord OAuth authorization URL (the frontend opens it — no
 * redirect performed here). NO DB read/write, NO external call.
 *
 * ⚠️ LOCKED quirks:
 *  - redirect_uri = APP_URL + "/callback/discord" (HARDCODED path, NOT env)
 *  - scopes = "identify guilds" (raw space; NOTHING URL-encoded)
 *  - success data is a URL STRING; message = "" (EMPTY, NOT "Success")
 */
export async function getDiscordRedirectUrl(): Promise<DiscordRedirectUrlEnvelope> {
  const clientId = constants.DISCORD_CLIENT_ID;
  const redirectUri = constants.APP_URL + "/callback/discord";
  const scopes = "identify guilds";

  const url =
    constants.DISCORD_OAUTH_AUTHORIZATION_URL +
    "?client_id=" +
    clientId +
    "&redirect_uri=" +
    redirectUri +
    "&response_type=code" +
    "&scope=" +
    scopes;

  return { isSuccess: true, data: url, message: "" };
}

/**
 * getDiscordUserDetails(accessToken) — GET /users/@me (user Bearer token).
 * NEVER throws:
 *   success    → { data, success: true }
 *   code set   → { success:false, error: "An error occured getting discord user information.", message: <code> }
 *   otherwise  → { error: <response data>, success: false }
 */
async function getDiscordUserDetails(accessToken: string): Promise<any> {
  try {
    const res = await axios.get(constants.DISCORD_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { data: res.data, success: true };
  } catch (error: any) {
    if (error?.response?.data?.code) {
      return {
        success: false,
        error: "An error occured getting discord user information.",
        message: error?.response?.data?.code,
      };
    }
    return { error: error?.response?.data, success: false };
  }
}

/** Envelope for POST /discord/user-info. */
export interface DiscordSaveEnvelope {
  isSuccess: boolean;
  data?: unknown;
  message?: unknown;
}

/**
 * POST /discord/user-info — behaviourally identical to the webapi
 * `ShareAbilityService.saveDiscordToken()` →
 * `DiscordService.saveDiscordToken(code, userId)`.
 *
 * OAuth code → token exchange (POST) → Discord profile (/users/@me) + the
 * user's postable guilds each flagged `connected` (bot presence) → save/update
 * the connection under `socialConnections.discord`.
 *
 * ⚠️ LOCKED quirks:
 *  - success message is lowercase "connected" (not "Success")
 *  - ALL failure branches pass `data` = EMPTY OBJECT {} (incl. the outer catch)
 *  - `handle.profileUrl` = `${SocialUrls["discord"]}/${username}` — SocialUrls
 *    has NO `discord` key → it literally becomes "undefined/<username>" (do NOT
 *    "fix" to a real URL)
 *  - account is REPLACED wholesale on the update path; reconnect first clears a
 *    stale `status == "disconnect"` on `.discord`
 *  - helpers never throw on API failures; only other errors reach the catch
 *
 * Only `social_connections` is written — the `users` doc is NEVER updated.
 * No notification / NATS / cron.
 */
export async function saveDiscordToken(
  code: string,
  userId: string
): Promise<DiscordSaveEnvelope> {
  try {
    // Step 1 — exchange the code (helper never throws).
    const response: any = await getDiscordAccessToken(code, undefined);
    const data = response?.data;

    // Step 2 — only when a token response came back.
    if (data) {
      const userData: any = await getDiscordUserDetails(data.access_token);
      const guildData: any = await getUserActiveGuilds(data.access_token);
      const getSocialConnect = await findByQuery({ userId });

      // Step 3 — only when the user fetch succeeded.
      if (userData?.success) {
        // ⚠️ SocialUrls has no `discord` key → undefined → "undefined/<username>".
        const socialUrlsDiscord = (
          constants.SOCIAL_URLS as Record<string, string | undefined>
        )["discord"];
        const handle = {
          validate: "isValid",
          username: userData?.data?.username,
          profileUrl: `${socialUrlsDiscord}/${userData?.data?.username}`,
        };

        const account = {
          userDetails: {
            username: userData?.data?.username,
            name: userData?.data?.global_name,
            picture: userData?.data?.avatar,
            id: userData?.data?.id,
          },
          guilds: guildData?.guilds,
          status: "connected",
          accessToken: data?.access_token,
          expireIn: data?.expires_in,
          scopes: data?.scope,
          refresh_token: data?.refresh_token,
          handle,
        };

        if (getSocialConnect.length > 0) {
          // Case B2a — existing doc (wholesale REPLACE account).
          const connection: any = { ...getSocialConnect[0] };
          // Deep-ensure chain: socialConnections → discord → discord.account.
          if (!connection.socialConnections)
            connection.socialConnections = {};
          if (!connection.socialConnections.discord)
            connection.socialConnections.discord = {};
          if (!connection.socialConnections.discord.account)
            connection.socialConnections.discord.account = {};
          // ⚠️ Reconnect — clear a stale "disconnect" status on .discord.
          if (connection.socialConnections.discord.status == "disconnect") {
            delete connection.socialConnections.discord.status;
          }
          connection.socialConnections.discord.account = account;
          await updateConnection(connection._id as string, connection);
        } else {
          // Case B2b — no existing doc → fresh insert.
          const socialObject = {
            userId,
            socialConnections: { discord: { account } },
          };
          await insertConnection(socialObject);
        }

        // Step 4 — success (message lowercase "connected").
        return {
          isSuccess: true,
          data: {
            user: {
              username: userData?.data?.username,
              name: userData?.data?.global_name,
              picture: userData?.data?.avatar,
            },
            guilds: guildData?.guilds,
            status: "connected",
          },
          message: "connected",
        };
      }

      // Step 5 — user fetch failed: data = {} (explicit), message = userData?.error.
      return { isSuccess: false, data: {}, message: userData?.error };
    }

    // Step 6 — no token response: data = {}; data?.error is undefined → message
    // key is omitted from the JSON body.
    return { isSuccess: false, data: {}, message: data?.error };
  } catch (error: any) {
    // Step 7 — outer catch (any thrown error): data = {}; message = the raw
    // axios error body (may be absent).
    return { isSuccess: false, data: {}, message: error?.response?.data };
  }
}
