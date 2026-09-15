import axios from "axios";
import { randomUUID } from "node:crypto";

import { constants } from "../config/constants";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";

/** Envelope for GET /facebook/redirect-url (data = a URL STRING). */
export interface FacebookRedirectUrlEnvelope {
  isSuccess: boolean;
  data: string;
  message: string;
}

/** Envelope for POST /facebook/user-info (success + guard paths). */
export interface FacebookSaveEnvelope {
  isSuccess: boolean;
  data?: unknown;
  message: string;
}

/**
 * ⚠️ CATCH result for POST /facebook/user-info — a PLAIN object with
 * `success` / `error` keys, NOT the ResponseModel (no isSuccess/message/data).
 */
export interface FacebookCatchResult {
  success: boolean;
  error: string;
}

/**
 * ENDPOINT A — GET /facebook/redirect-url
 * Builds the Facebook OAuth authorization URL (the frontend opens it — no
 * redirect is performed here). NO DB read/write, NO external call.
 *
 * ⚠️ LOCKED quirks:
 *  - `state = randomUUID()` is generated fresh every call but NEVER stored or
 *    validated (stateless)
 *  - URL is built with NO URL-encoding anywhere (raw interpolation)
 *  - `redirect_uri` = APP_URL + FB_CALLBACK_URL (plain concatenation)
 *  - scopes = 'email,public_profile,pages_show_list,pages_manage_posts'
 *  - success `data` is a URL STRING; message "Success"
 */
export async function getFacebookRedirectUrl(): Promise<FacebookRedirectUrlEnvelope> {
  const clientId = constants.FB_APP_ID;
  // Plain concatenation, no separator.
  const redirectUri = constants.APP_URL + constants.FB_CALLBACK_URL;
  const state = randomUUID();
  const scopes = "email,public_profile,pages_show_list,pages_manage_posts";

  const url =
    `${constants.FB_AUTH_URL}?client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}` +
    `&scope=${scopes}`;

  return { isSuccess: true, data: url, message: "Success" };
}

/**
 * getFacebookUserData(accessToken) — GET /v19.0/me (id,name,email,picture) and,
 * on HTTP 200, also GET the accounts endpoint.
 *
 * NEVER throws:
 *   200 both  → { user: <me data>, accounts: <accounts response>, success: true }
 *   non-200   → { error: <data>, success: false }
 *   axios failure → { error: error?.message, success: false }
 */
async function getFacebookUserData(
  accessToken: string
): Promise<Record<string, any>> {
  try {
    const userRes = await axios.get(constants.FB_USER_INFO_URL, {
      params: { fields: "id,name,email,picture", access_token: accessToken },
    });
    if (userRes.status === 200) {
      const accountsRes = await axios.get(
        `${constants.FB_GET_ACCOUNTS}?access_token=${accessToken}`
      );
      return { user: userRes.data, accounts: accountsRes.data, success: true };
    }
    return { error: userRes.data, success: false };
  } catch (error: any) {
    return { error: error?.message, success: false };
  }
}

/**
 * ENDPOINT B — POST /facebook/user-info
 * OAuth callback `code` → token exchange (GET Graph /oauth/access_token) →
 * fetch the profile (/me) + pages (accounts) → save/update the connection
 * under `socialConnections.facebook` in `social_connections`.
 *
 * ⚠️ LOCKED responses:
 *   ok:          { true, userData?.user?.name, "Conncted" }   (typo "Conncted" preserved)
 *   user fetch !ok: { false, userData?.error, "" }
 *   no access_token: { false, <no data>, "" }
 *   catch:       { success: false, error: error?.response?.data?.error?.message || error?.message }
 *                (PLAIN object — NOT the ResponseModel)
 *
 * Only `social_connections` is written — the `users` doc is NEVER updated.
 * No notification / NATS / cron.
 */
export async function saveFacebookToken(
  userId: string,
  code: string
): Promise<FacebookSaveEnvelope | FacebookCatchResult> {
  // Step 1 — build the token URL OUTSIDE the try/catch (a URLSearchParams
  // failure here throws with NO envelope at all).
  const params = new URLSearchParams({
    code,
    redirect_uri: constants.APP_URL + constants.FB_CALLBACK_URL,
    client_id: constants.FB_APP_ID,
    client_secret: constants.FB_APP_SECRET,
  });
  const tokenURL =
    `https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`;

  try {
    // Step 2 — exchange the code.
    const response = await axios.get(tokenURL);
    const data = response.data;

    // Step 3 — look up the existing doc.
    const getSocialConnect = await findByQuery({ userId });

    // Step 4 — only proceed when an access_token was returned.
    if (data?.access_token) {
      const userData: Record<string, any> = await getFacebookUserData(
        data.access_token
      );

      if (userData?.success) {
        // Step 5 — persist under socialConnections.facebook.
        if (getSocialConnect.length > 0) {
          // Case B2a — existing connection doc.
          const connection: any = { ...getSocialConnect[0] };
          // Deep-ensure chain: socialConnections → facebook → facebook.account.
          if (!connection.socialConnections)
            connection.socialConnections = {};
          if (!connection.socialConnections.facebook)
            connection.socialConnections.facebook = {};
          if (!connection.socialConnections.facebook.account)
            connection.socialConnections.facebook.account = {};
          // ⚠️ Reconnect — clear a stale "disconnect" status on .facebook.
          if (connection.socialConnections.facebook.status == "disconnect") {
            delete connection.socialConnections.facebook.status;
          }
          // Spreads the EXISTING account first, then overwrites the keys below.
          connection.socialConnections.facebook.account = {
            ...(connection.socialConnections.facebook.account || {}),
            // pages array only (NOT the whole accounts response).
            accounts: userData?.accounts?.data,
            userDetails: userData?.user,
            status: "connected",
            accessToken: data?.access_token,
          };
          await updateConnection(connection._id as string, connection);
        } else {
          // Case B2b — no existing doc → fresh insert.
          const socialObject = {
            userId,
            socialConnections: {
              facebook: {
                account: {
                  accounts: userData?.accounts?.data,
                  userDetails: userData?.user,
                  status: "connected",
                  accessToken: data?.access_token,
                },
              },
            },
          };
          await insertConnection(socialObject);
        }

        // Step 6 — success (data = the /me NAME string; "Conncted" typo kept).
        return {
          isSuccess: true,
          data: userData?.user?.name,
          message: "Conncted",
        };
      }

      // Step 7 — user/accounts fetch failed (empty-string message).
      return { isSuccess: false, data: userData?.error, message: "" };
    }

    // Step 8 — no access_token in the token response (no data arg passed).
    return { isSuccess: false, message: "" };
  } catch (error: any) {
    // Step 9 — PLAIN object (success/error), NOT the ResponseModel.
    return {
      success: false,
      error:
        error?.response?.data?.error?.message || error?.message,
    };
  }
}
