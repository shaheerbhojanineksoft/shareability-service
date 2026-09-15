import axios from "axios";
import { createHash, randomBytes } from "node:crypto";

import { constants } from "../config/constants";
import type { SaveTwitterTokenInput } from "../dto/save-twitter-token.dto";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";

/** Envelope for GET /x/redirect-url (data = { redirectUrl, verifier }). */
export interface TwitterRedirectUrlEnvelope {
  isSuccess: boolean;
  data: { redirectUrl: string; verifier: string };
  message: string;
}

/**
 * Envelope for POST /x/user-info — mirrors the microservice `ResponseModel`
 * (`isSuccess` / `data?` / `message?`). `data`/`message` keys are OMITTED from
 * the JSON body when undefined. The whole method may also return `undefined`
 * on the rare "no access_token" edge (no envelope at all).
 */
export interface TwitterUserInfoEnvelope {
  isSuccess: boolean;
  data?: unknown;
  message?: string;
}

/** Token-exchange helper result (see getTwitterUserToken). */
interface TwitterTokenResponse {
  data?: Record<string, any>;
  success: boolean;
  error?: any;
}

/**
 * PKCE S256 helper:
 *   verifier  = randomBytes(32).toString('base64url')
 *   challenge = base64url(sha256(verifier))
 */
function generatePKCECodes(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * ENDPOINT A — GET /x/redirect-url
 * Generates a fresh PKCE verifier + challenge and returns the X authorization
 * URL AND the verifier (the frontend must retain it — the OAuth `state` IS the
 * verifier). No redirect is performed here.
 *
 * ⚠️ LOCKED response:
 *   { isSuccess: true, data: { redirectUrl, verifier }, message: "Success" }
 * URL is built with RAW interpolation — nothing is URL-encoded (scopes keep
 * raw spaces, redirect_uri is un-encoded). On error the microservice lets it
 * propagate — there is no ResponseModel failure body (no try/catch needed).
 */
export async function getTwitterRedirectUrl(): Promise<TwitterRedirectUrlEnvelope> {
  const { verifier, challenge } = generatePKCECodes();
  const clientId = constants.TWITTER_CLIENT_ID;
  // Plain concatenation, no separator.
  const callbackUrl = constants.APP_URL + constants.TWITTER_CALLBACK_URL;
  const scopes = "tweet.read tweet.write users.read offline.access media.write";
  const method = "S256";
  // ⚠️ the OAuth `state` IS the PKCE verifier (this is how the verifier round-trips).
  const state = verifier;

  const redirectUrl =
    `${constants.TWITTER_AUTH_URL}?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${callbackUrl}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=${method}` +
    `&state=${state}` +
    `&scope=${scopes}`;

  return { isSuccess: true, data: { redirectUrl, verifier }, message: "Success" };
}

/**
 * getTwitterUserToken(verifier, code) — POST the authorization_code to the X
 * token endpoint (Basic auth, form-urlencoded body, NO client_secret in body).
 *
 * NEVER throws:
 *   success → { success: true, data: <token response> }
 *   axios failure → { success: false, error: error?.response?.data }
 */
async function getTwitterUserToken(
  verifier: string,
  code: string
): Promise<TwitterTokenResponse> {
  try {
    const redirectUri = constants.APP_URL + constants.TWITTER_CALLBACK_URL;
    const basic = Buffer.from(
      `${constants.TWITTER_CLIENT_ID}:${constants.TWITTER_CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: constants.TWITTER_CLIENT_ID,
    });

    const res = await axios.post(
      constants.TWITTER_GET_TOKEN_API,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
      }
    );
    return { success: true, data: res.data };
  } catch (error: any) {
    // The JSON error body (e.g. { error: "unauthorized_client", ... }).
    return { success: false, error: error?.response?.data };
  }
}

/**
 * getTwitterUserDetails(accessToken) — GET https://api.X.com/2/users/me.
 *
 * NEVER throws:
 *   status 200 → { data: response.data, success: true }
 *                (profile at `data.data` = { id, name, username, ... })
 *   axios failure → { error: error?.response?.data || error?.message, success: false }
 */
async function getTwitterUserDetails(
  accessToken: string
): Promise<Record<string, any>> {
  try {
    const res = await axios.get(constants.X_URLS_V2_ACCESS_TOKEN, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    return { data: res.data, success: true };
  } catch (error: any) {
    return {
      error: error?.response?.data || error?.message,
      success: false,
    };
  }
}

/**
 * ENDPOINT B — POST /x/user-info
 * PKCE OAuth callback: exchange `code` + `verifier` for an X access token,
 * fetch the profile (/2/users/me) and save/update the connection under
 * `socialConnections.x` in `social_connections`.
 *
 * ⚠️ LOCKED responses:
 *   ok:            { true, { userData: { handle, user: { username, name }, status: "connected" } }, "Success" }
 *   user fetch !ok:{ false, <no data>, userData?.error }
 *   catch:         { false, <no data>, error?.response?.data?.error }  (may itself be absent)
 *   no access_token edge: returns `undefined` (no envelope) — preserved as-is.
 *
 * Only `social_connections` is written — the `users` doc is NEVER updated.
 * No notification / NATS / cron. `state` is never read.
 */
export async function saveTwitterToken(
  data: SaveTwitterTokenInput
): Promise<TwitterUserInfoEnvelope | undefined> {
  try {
    // Step 1 — exchange the code for tokens (helper never throws).
    const response: TwitterTokenResponse = await getTwitterUserToken(
      data.verifier,
      data.code
    );

    // Step 2 — token-exchange failure → throw the error body (caught in Step 7).
    if (!response?.success) {
      throw { response: { data: response?.error } };
    }

    // Step 3 — only proceed when an access_token was returned.
    if (response?.data?.access_token) {
      const userData: Record<string, any> = await getTwitterUserDetails(
        response.data.access_token
      );
      const getSocialConnect = await findByQuery({ userId: data.userId });

      // Step 4 — user fetch success → persist under socialConnections.x.
      if (userData?.success) {
        const handle = {
          validate: "isValid",
          username: userData.data.data.username,
          // SocialUrls.x — https://www.x.com/<username>
          profileUrl: `${constants.SOCIAL_URLS.x}/${userData.data.data.username}`,
        };

        if (getSocialConnect.length > 0) {
          // Case B2a — existing connection doc found.
          const connection: any = { ...getSocialConnect[0] };
          // Deep-ensure chain: socialConnections → x → x.account.
          if (!connection.socialConnections) connection.socialConnections = {};
          if (!connection.socialConnections.x) connection.socialConnections.x = {};
          if (!connection.socialConnections.x.account)
            connection.socialConnections.x.account = {};
          // ⚠️ Reconnect — clear a stale "disconnect" status on .x.
          if (connection.socialConnections.x.status == "disconnect") {
            delete connection.socialConnections.x.status;
          }
          // This REPLACES socialConnections.x.account wholesale (not a merge).
          connection.socialConnections.x.account = {
            userDetails: userData.data.data,
            status: "connected",
            accessToken: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expireIn: response.data.expires_in,
            scopes: response.data.scope,
            handle,
          };
          await updateConnection(connection._id as string, connection);
        } else {
          // Case B2b — no existing doc → fresh insert.
          const socialObject = {
            userId: data.userId,
            socialConnections: {
              x: {
                account: {
                  userDetails: userData.data.data,
                  status: "connected",
                  accessToken: response.data.access_token,
                  refresh_token: response.data.refresh_token,
                  expireIn: response.data.expires_in,
                  scopes: response.data.scope,
                  handle,
                },
              },
            },
          };
          await insertConnection(socialObject);
        }

        // Step 5 — success return (NOT the saved doc, NOT the full payload).
        const username = userData.data.data.username;
        const name = userData.data.data.name;
        return {
          isSuccess: true,
          data: {
            userData: {
              handle,
              user: { username, name },
              status: "connected",
            },
          },
          message: "Success",
        };
      }

      // Step 6 — user fetch failed → no data field (userData.error is a string).
      return { isSuccess: false, message: userData?.error };
    }

    // ⚠️ Rare edge — token exchange OK but no `access_token` in the response:
    // fall through and return `undefined` (no envelope). Preserved as-is.
    return undefined;
  } catch (error: any) {
    // Step 7 — token-exchange failure / anything else. Both source branches are
    // IDENTICAL: message = error?.response?.data?.error (may itself be absent,
    // in which case the message key is omitted from the JSON body).
    return { isSuccess: false, message: error?.response?.data?.error };
  }
}
