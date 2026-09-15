import { constants } from "../config/constants";
import type { VerifyUsernameInput } from "../dto/verify-username.dto";
import type { SavePlatformInput } from "../dto/save-platform.dto";
import type { DisconnectPlatformInput } from "../dto/disconnect-platform.dto";
import {
  findByQuery,
  insertConnection,
  updateConnection,
} from "../repositories/socialConnections.repo";
import { checkFacebookUsername } from "./social/facebook.checker";
import { checkInstagramUsername } from "./social/instagram.checker";
import { checkLinkedInUser } from "./social/linkedin.checker";
import { checkRedditUser } from "./social/reddit.checker";
import { checkTelegramUser } from "./social/telegram.checker";
import { checkForTwitter } from "./social/x.checker";

/**
 * Response envelope (mirrors getResponseObject(isSuccess, message, data)).
 * NOTE: `isSuccess` may be `undefined` (facebook-invalid quirk) — JSON
 * serialization then OMITS the key.
 */
export interface ResponseModel<T> {
  isSuccess: boolean | undefined;
  data: T;
  message: string;
}

/**
 * Multi-platform username verification dispatcher — mirrors the webapi
 * `SocialService.getHandles()`.
 *
 * Supported platforms (EXACT, case-sensitive): facebook, linkedin, x, reddit,
 * instagram, telegram. `data` is a NUMBER status code (200/404/402/500).
 *
 * ⚠️ LOCKED messages:
 *   found:  { true, 200, "Valid!" }
 *   missing:{ false, 404, "Not Found!" }
 *   fb invalid: { undefined (omitted), 404, "Not Found!" }
 *   unknown:  { false, 402, "Please provide the valid platform" }
 *   catch:    { false, 500, "Something went wrong" } (lowercase went, no period)
 */
export async function getHandles(
  data: VerifyUsernameInput
): Promise<ResponseModel<number>> {
  let isValid: boolean | undefined = false;

  try {
    switch (data.platform) {
      case "facebook":
        isValid = await checkFacebookUsername(
          constants.SOCIAL_URLS.facebook,
          data.username
        );
        break;
      case "linkedin":
        isValid = await checkLinkedInUser(
          constants.SOCIAL_URLS.linkedin,
          data.username
        );
        break;
      case "x":
        isValid = await checkForTwitter(constants.SOCIAL_URLS.x, data.username);
        break;
      case "reddit":
        isValid = await checkRedditUser(data.username);
        break;
      case "instagram":
        isValid = await checkInstagramUsername(
          constants.SOCIAL_URLS.instagram,
          data.username
        );
        break;
      case "telegram":
        isValid = await checkTelegramUser(
          constants.SOCIAL_URLS.telegram,
          data.username
        );
        break;
      default:
        return {
          isSuccess: false,
          data: 402,
          message: "Please provide the valid platform",
        };
    }

    return {
      isSuccess: isValid,
      data: isValid ? 200 : 404,
      message: isValid ? "Valid!" : "Not Found!",
    };
  } catch {
    return { isSuccess: false, data: 500, message: "Something went wrong" };
  }
}

/** Envelope for POST /save-handle. */
export interface SavePlatformResponse {
  isSuccess: boolean;
  data: Record<string, unknown> | number;
  message: string;
}

/**
 * POST /save-handle — behaviourally identical to the webapi
 * `ShareAbilityService.savePlatfrom()` → `SocialService.savePlatform()`.
 *
 * Persists the outcome of a verify-username check into `social_connections`:
 * insert when the user has no doc yet, else update (merge). One Mongo write.
 * ❌ Social-link notification is NOT sent (commented-out in webapi).
 *
 * ⚠️ LOCKED:
 *   success: { true, <initially-built socialObject>, "Save Successfully" }
 *   catch:   { false, 500 (NUMBER), "Something went wrong" } (lowercase went, no period)
 *   handle.validate: "isValid" | "isInvalid"; username stored with `|| ""`.
 *   Returned `data` is ALWAYS the freshly-built object — even in the update
 *   path (NOT the merged existing doc).
 */
export async function savePlatform(
  data: SavePlatformInput
): Promise<SavePlatformResponse> {
  try {
    // Step 1 — build the (returned) object.
    const socialObject: Record<string, any> = {
      userId: data.userId,
      socialConnections: {},
    };
    socialObject.socialConnections[data.platform] = {
      ...(socialObject.socialConnections[data.platform] as any),
      handle: { validate: data.isValid ? "isValid" : "isInvalid" },
      account: {
        userDetails: { username: data.username || "" },
      },
    };

    // Step 2 — find an existing doc.
    const docs = await findByQuery({ userId: data.userId });

    if (docs && docs.length > 0) {
      // Step 3b — UPDATE (merge).
      const existing: any = docs[0];
      if (
        existing.socialConnections?.[data.platform]?.status === "disconnect"
      ) {
        // Reconnecting clears the "disconnect" status.
        delete existing.socialConnections[data.platform].status;
      }
      existing.socialConnections[data.platform] = {
        ...(existing.socialConnections?.[data.platform] || {}),
        handle: { validate: data.isValid ? "isValid" : "isInvalid" },
        account: {
          ...(existing.socialConnections?.[data.platform]?.account || {}),
          userDetails: {
            ...(existing.socialConnections?.[data.platform]?.account
              ?.userDetails || {}),
            username: data.username || "",
          },
        },
      };
      await updateConnection(existing._id as string, existing);
    } else {
      // Step 3a — INSERT (wrapper adds _id/createdOn/isDeleted).
      await insertConnection(socialObject);
    }

    // Step 4 — always return the initially-built socialObject.
    return { isSuccess: true, data: socialObject, message: "Save Successfully" };
  } catch {
    return { isSuccess: false, data: 500, message: "Something went wrong" };
  }
}

/** Envelope for GET /disconnect-platform. */
export interface DisconnectPlatformEnvelope {
  isSuccess: boolean;
  /** Only present (the raw caught error) on the exception case. */
  data?: unknown;
  message: string;
}

/**
 * GET /disconnect-platform — behaviourally identical to the webapi
 * `ShareAbilityService.disconnectPlatform()` →
 * `SocialService.disconnectSocialConnection(userId, platform)`.
 *
 * Marks a single connected social platform as disconnected by REPLACING
 * `socialConnections.<platform>` with `{ status: "disconnect" }` — the stored
 * `handle` / `account` sub-objects are dropped, NOT merged. One Mongo UPDATE
 * (never an insert — the user must already have a `social_connections` doc).
 * Only `social_connections` is written; no notification / NATS / cron.
 *
 * ⚠️ LOCKED responses — `data` is OMITTED from the JSON body on every case
 * except the exception one:
 *   no doc:       { false,            "Connection not created!" }  (no create)
 *   unknown plat: { false,            "Invalid Platform" }
 *   success:      { true,             "Disconnect Successfully" }
 *   catch:        { false, <raw error>, "Something went wrong" }  (data = error obj)
 */
export async function disconnectSocialConnection(
  data: DisconnectPlatformInput
): Promise<DisconnectPlatformEnvelope> {
  try {
    // Step 1 — find the user's doc.
    const docs = await findByQuery({ userId: data.userId });

    // Step 2 — guard: no doc → error (update only, NEVER insert/create).
    if (!docs || docs.length === 0) {
      return { isSuccess: false, message: "Connection not created!" };
    }

    // Step 3 — guard: unknown platform → error.
    // Shallow copy (mirrors `connection = { ...getConnection[0] }`). A missing
    // `socialConnections` object throws here → falls through to the catch.
    const connection: any = { ...docs[0] };
    if (!connection.socialConnections[data.platform]) {
      return { isSuccess: false, message: "Invalid Platform" };
    }

    // Step 4 — mark disconnected: REPLACES the whole <platform> object
    // (handle / account and any other keys are overwritten — do NOT merge).
    connection.socialConnections[data.platform] = { status: "disconnect" };

    // Step 5 — persist the full doc ($set keeps userId + other platforms).
    await updateConnection(connection._id as string, connection);

    // Step 6 — return.
    return { isSuccess: true, message: "Disconnect Successfully" };
  } catch (error) {
    // data = the RAW caught error object (NOT the number 500 — save-handle's
    // catch differs here).
    return { isSuccess: false, data: error, message: "Something went wrong" };
  }
}
