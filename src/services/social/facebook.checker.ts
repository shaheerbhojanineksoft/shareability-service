import axios from "axios";

import { constants } from "../../config/constants";

/** HTML markers that mean the facebook profile does not exist. */
const INVALID_MARKERS = [
  "This Content Isn't Available",
  "Page isn't available",
  "content isn't available",
  "Log into Facebook",
  "This content isn't available at the moment",
];

/**
 * Facebook checker — axios (NO browser).
 *
 * ⚠️ Exact quirks:
 *  - invalid → returns `undefined` (there is NO `return false`) → propagates
 *    to `isValid = undefined` → the `isSuccess` key disappears from JSON.
 *  - not invalid → `true`
 *  - axios throws → `false`
 */
export async function checkFacebookUsername(
  baseUrl: string,
  username: string
): Promise<boolean | undefined> {
  try {
    const res = await axios.get(`${baseUrl}/${username}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Cookie: `c_user=${constants.FACEBOOK_COOKIE_C_USER}; xs=${constants.FACEBOOK_COOKIE_XS};`,
      },
      maxRedirects: 0,
      validateStatus: (status) => [200, 302, 404].includes(status),
    });

    const html = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const isInvalid = INVALID_MARKERS.some((marker) => html.includes(marker));

    if (isInvalid) {
      return undefined; // NOT `return false` — mirrors the webapi
    }
    return true;
  } catch {
    return false;
  }
}
