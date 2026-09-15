import { decodeJwt } from "jose";
import { randomUUID } from "node:crypto";

import { constants } from "../config/constants";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";

/** Shared envelope — mirrors `ResponseModel` / `getResponseObject(isSuccess, message, data)`. */
export interface ResponseModel<T> {
  isSuccess: boolean;
  data: T;
  message: string;
}

/** Token-exchange helper result (see getLinkedinUserAccessToken). */
interface TokenResponse {
  data?: Record<string, any>;
  success: boolean;
  message?: string;
  error?: any;
}

/**
 * ENDPOINT A — GET /linkedin/redirect-url
 * Returns the LinkedIn OAuth authorization URL (frontend does the redirect).
 *
 * ⚠️ LOCKED response: { isSuccess: true, data: <url>, message: "Success" }.
 * Only `redirect_uri` is URL-encoded; scopes stay raw space-separated.
 * `state = randomUUID()` is generated fresh every call but never stored.
 */
export async function getLinkedinRedirectUrl(): Promise<ResponseModel<string>> {
  const clientId = constants.LINKEDIN_APP_API_KEY;
  // Plain concatenation, no separator.
  const redirectUri = constants.APP_URL + constants.LINKEDIN_CALLBACK_URL;
  const scopes = constants.LINKEDIN_SCOPES;
  const state = randomUUID();

  const url =
    `${constants.LINKEDIN_AUTH_URL}?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&state=${state}`;

  return { isSuccess: true, data: url, message: "Success" };
}

/**
 * ENDPOINT B — POST /linkedin/user-info
 * OAuth callback `code` exchange → LinkedIn access token + decoded id_token
 * profile → save/update the connection under `social_connections`.
 *
 * ⚠️ LOCKED response strings:
 *   ok:              { true, decoded?.name, "Connected" }
 *   invalid_request: { false, undefined, "Invalid or expired token, Please try again to connect" }
 *   no data other:   { false, response?.error, response?.message }
 *   catch 400:       { false, error?.response?.data?.error, "" }
 *   catch other:     { false, "", "Cannot fetch user details" }
 *
 * Only `social_connections` is written — the `users` doc is NEVER updated
 * (the webapi `user.save()` block is commented out — do not resurrect).
 */
export async function saveLinkedinToken(
  userId: string,
  code: string
): Promise<ResponseModel<unknown>> {
  let response: TokenResponse | undefined;

  try {
    // Step 1 — exchange code for an access token (helper never throws).
    response = await getLinkedinUserAccessToken(code);
    const data = response?.data;

    if (data) {
      // Step 2 — decode id_token only (NO signature verification / expiry).
      let decoded: any = null;
      try {
        decoded = decodeJwt(data?.id_token ?? "");
      } catch {
        decoded = null;
      }

      // Step 3 — persist only when decoded.sub is truthy.
      if (decoded && decoded.sub) {
        const { sub, name, email, picture } = decoded;

        // Case B2b path — fresh insert.
        const socialObject = {
          userId,
          socialConnections: {
            linkedin: {
              account: {
                userDetails: { sub, name, email, picture },
                status: "connected",
                accessToken: data?.access_token,
                expireIn: data?.expires_in,
                scopes: data?.scope,
              },
            },
          },
        };

        // Case B2a — existing connection doc found → merge account + userDetails.
        const existing = await findByQuery({ userId });
        if (existing && existing.length > 0) {
          const connection: any = { ...existing[0] };
          // Deep-ensure chain: socialConnections → linkedin → account.
          if (!connection.socialConnections) connection.socialConnections = {};
          if (!connection.socialConnections.linkedin)
            connection.socialConnections.linkedin = {};
          if (!connection.socialConnections.linkedin.account)
            connection.socialConnections.linkedin.account = {};

          const existingAccount = connection.socialConnections.linkedin.account || {};
          const existingUserDetails = existingAccount.userDetails || {};

          connection.socialConnections.linkedin.account = {
            ...existingAccount,
            userDetails: { ...existingUserDetails, sub, name, email, picture },
            status: "connected",
            accessToken: data?.access_token,
            expireIn: data?.expires_in,
            scopes: data?.scope,
          };

          const id = connection._id as string;
          await updateConnection(id, connection);
        } else {
          await insertConnection(socialObject);
        }
      }

      // Step 4 — success data is the NAME string (may be undefined on decode fail).
      return { isSuccess: true, data: decoded?.name, message: "Connected" };
    }

    // No `data` — surface the LinkedIn error.
    if (response?.error?.error === "invalid_request") {
      return {
        isSuccess: false,
        data: undefined,
        message: "Invalid or expired token, Please try again to connect",
      };
    }
    return {
      isSuccess: false,
      data: response?.error,
      // Failure responses from the helper always carry this message string.
      message: response?.message as string,
    };
  } catch (error: any) {
    // Outer catch only fires for code OUTSIDE getLinkedinUserAccessToken.
    if (error?.response?.data?.error === "invalid_request" && error?.status == 400) {
      return {
        isSuccess: false,
        data: error?.response?.data?.error,
        message: "",
      };
    }
    return { isSuccess: false, data: "", message: "Cannot fetch user details" };
  }
}

/**
 * Step 1 helper — POST the authorization code to LinkedIn's accessToken URL.
 *
 * NEVER throws on LinkedIn failure — returns
 *   success → { data: <token response>, success: true }
 *   failure → { message: "Error while getting access token of linkedin", success: false, error }
 * where `error = error?.response?.data || error.message`.
 *
 * (The grant_type=refresh_token path exists in the webapi helper but nothing
 * ever calls it here — not implemented.)
 */
async function getLinkedinUserAccessToken(code: string): Promise<TokenResponse> {
  try {
    const redirectUri = constants.APP_URL + constants.LINKEDIN_CALLBACK_URL;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: constants.LINKEDIN_APP_API_KEY,
      client_secret: constants.LINKEDIN_APP_SECRET_KEY,
    });

    const res = await fetch(constants.LINKEDIN_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      // axios would have thrown here — mirror `error?.response?.data || error.message`.
      let error: any = res.statusText;
      try {
        error = await res.json();
      } catch {
        error = await res.text().catch(() => res.statusText);
      }
      return {
        message: "Error while getting access token of linkedin",
        success: false,
        error,
      };
    }

    const data = (await res.json()) as Record<string, any>;
    return { data, success: true };
  } catch (err: any) {
    const error = err?.response?.data || err?.message;
    return {
      message: "Error while getting access token of linkedin",
      success: false,
      error,
    };
  }
}
