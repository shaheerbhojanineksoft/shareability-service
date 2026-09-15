import axios from "axios";

import { constants } from "../config/constants";
import type { GetTelegramUserInfoInput } from "../dto/get-telegram-user-info.dto";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";

/** Envelope for GET /telegram/redirect-url (data = a URL STRING). */
export interface TelegramRedirectUrlEnvelope {
  isSuccess: boolean;
  data: string;
  message: string;
}

/** Envelope for GET /telegram/user-info. */
export interface TelegramUserInfoEnvelope {
  isSuccess: boolean;
  data?: unknown;
  message: string;
}

/**
 * ENDPOINT A — GET /telegram/redirect-url
 * Builds the Telegram Login-Widget authorization URL (the frontend opens it —
 * no redirect is performed here). NO DB read/write, NO external call.
 *
 * ⚠️ LOCKED quirks:
 *  - success `data` is a URL STRING (not an object)
 *  - `bot_id` = the FULL TELEGRAM_BOT_TOKEN (the split `token.split(":")[0]`
 *    botId in the source is dead code — NOT used in the URL)
 *  - ONLY `origin` is URL-encoded: encodeURIComponent(APP_URL + "/callback/telegram/")
 *  - message: "Success"
 */
export async function getTelegramRedirectUrl(): Promise<TelegramRedirectUrlEnvelope> {
  // Only this piece is URL-encoded.
  const redirectUrl = encodeURIComponent(
    `${constants.APP_URL}/callback/telegram/`
  );

  const url =
    `${constants.TELEGRAM_OAUTH_AUTHORIZATION_URL}?bot_id=${constants.TELEGRAM_BOT_TOKEN}` +
    `&origin=${redirectUrl}` +
    `&embed=1` +
    `&request_access=write`;

  return { isSuccess: true, data: url, message: "Success" };
}

/**
 * getUserDataByToken(token) — base64url → base64 → decode → JSON.parse.
 * ⚠️ NO hash/signature verification and NO expiry check (pure decode + parse).
 * Throws on bad base64/JSON → caught by the outer catch in getTelegramUserInfo.
 */
function getUserDataByToken(token: string): Record<string, any> {
  // atob-equivalent decode (base64url→base64), same as the microservice.
  const decodedString = Buffer.from(
    token.replace(/_/g, "/").replace(/-/g, "+"),
    "base64"
  ).toString("utf-8");
  return JSON.parse(decodedString) as Record<string, any>;
}

/** A single channel entry collected from the bot's getUpdates. */
interface TelegramChannel {
  id: number;
  title?: string;
  status?: string;
}

/**
 * getUserChannels(userId) — GET /bot<token>/getUpdates and collect the bot's
 * channel chats. ⚠️ The `userId` argument is NEVER used inside (kept for parity
 * with the source signature).
 *
 * For each update: `chat = update.my_chat_member?.chat ||
 * update.channel_post?.chat || update.message?.chat`; keep only
 * `chat.type === "channel"` whose status !== "left" (status =
 * `my_chat_member.new_chat_member.status || update.status`), deduped by
 * chat.id via a Map.
 *
 * NEVER throws:
 *   ok      → array of { id, title, status }
 *   axios failure → literal `false`
 */
async function getUserChannels(
  userId: string
): Promise<TelegramChannel[] | false> {
  try {
    const res = await axios.get(
      `${constants.TELEGRAM_API_URL}/bot${constants.TELEGRAM_BOT_TOKEN}/getUpdates`
    );
    const updates: any[] = res.data?.result ?? [];

    const channelMap = new Map<number, TelegramChannel>();
    for (const update of updates) {
      const chat =
        update?.my_chat_member?.chat ||
        update?.channel_post?.chat ||
        update?.message?.chat;
      if (chat?.type === "channel") {
        const status =
          update?.my_chat_member?.new_chat_member?.status || update?.status;
        if (status !== "left") {
          channelMap.set(chat.id, {
            id: chat.id,
            title: chat.title,
            status,
          });
        }
      }
    }
    return Array.from(channelMap.values());
  } catch {
    // axios failure → literal false (NEVER throws).
    return false;
  }
}

/**
 * ENDPOINT B — GET /telegram/user-info?code=…
 * Decodes the Telegram Login Widget return `code` (base64url JSON user blob —
 * decoded but NOT signature-verified), pulls the bot's channels and saves /
 * updates the connection under `socialConnections.telegram`.
 *
 * ⚠️ LOCKED responses:
 *   ok:      { true, { user: { username, name, picture }, channels, status: "connected" }, "Save Successfully" }
 *   no id:   { false, <no data>, "Error while getting user channel details" }
 *   catch:   { false, { error: <caught error> }, "Something went wrong" }
 *
 * ⚠️ The success body is returned even when the channel fetch fails
 * (`channels: false`) — and in that case NO Mongo write happens (the return
 * sits OUTSIDE the `if (channels)` block). Empty channel array ([]) is truthy
 * → DB write still happens. The update path does NOT clear a prior
 * `status: "disconnect"` on `.telegram` (unlike X).
 *
 * Only `social_connections` is written — the `users` doc is NEVER updated.
 * No notification / NATS / cron.
 */
export async function getTelegramUserInfo(
  data: GetTelegramUserInfoInput
): Promise<TelegramUserInfoEnvelope> {
  try {
    // Step 1 — decode the token (bad base64/JSON throws → caught in Step 5).
    const telegramUserData: Record<string, any> = getUserDataByToken(
      data.token
    );

    // Step 2 — look up the existing doc.
    const getSocialConnect = await findByQuery({ userId: data.userId });

    // Step 3 — only when the decoded user has an `id`.
    if (telegramUserData?.id) {
      // Step 3a — fetch the bot's channels (never throws; `false` on failure).
      const channels: TelegramChannel[] | false = await getUserChannels(
        data.userId
      );

      // Step 3b — persist ONLY when `channels` is truthy ([] is truthy).
      if (channels) {
        if (getSocialConnect.length > 0) {
          // Existing doc — wholesale REPLACE socialConnections.telegram.account.
          const connection: any = { ...getSocialConnect[0] };
          // Deep-ensure chain: socialConnections → telegram → telegram.account.
          if (!connection.socialConnections) connection.socialConnections = {};
          if (!connection.socialConnections.telegram)
            connection.socialConnections.telegram = {};
          if (!connection.socialConnections.telegram.account)
            connection.socialConnections.telegram.account = {};
          // ⚠️ No stale "disconnect" status clearing here (unlike X).
          connection.socialConnections.telegram.account = {
            userDetails: telegramUserData,
            status: "connected",
            token: data.token,
            channels,
          };
          await updateConnection(connection._id as string, connection);
        } else {
          // No existing doc → fresh insert.
          const socialObject = {
            userId: data.userId,
            socialConnections: {
              telegram: {
                account: {
                  userDetails: telegramUserData,
                  status: "connected",
                  token: data.token,
                  channels,
                },
              },
            },
          };
          await insertConnection(socialObject);
        }
      }

      // Step 3c — success return sits OUTSIDE the `if (channels)` block: a
      // failed channel fetch still returns this body with `channels: false`
      // and NO Mongo write.
      return {
        isSuccess: true,
        data: {
          user: {
            username: telegramUserData?.username,
            name: telegramUserData?.first_name,
            picture: telegramUserData?.photo_url,
          },
          channels,
          status: "connected",
        },
        message: "Save Successfully",
      };
    }

    // Step 4 — decoded user has no `id` → no `data` arg passed.
    return {
      isSuccess: false,
      message: "Error while getting user channel details",
    };
  } catch (error) {
    // Step 5 — outer catch (decode/parse, mongo, anything thrown):
    // data = the whole caught error wrapped as `{ error }`.
    return {
      isSuccess: false,
      data: { error },
      message: "Something went wrong",
    };
  }
}
