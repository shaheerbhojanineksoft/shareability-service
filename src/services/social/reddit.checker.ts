import axios from "axios";

import { constants } from "../../config/constants";

/**
 * Step 1 — admin OAuth client-credentials token.
 * `POST https://www.reddit.com/api/v1/access_token` with Basic auth.
 * Returns `data.access_token`; THROWS on failure (axios rejects non-2xx).
 */
async function getRedditTokenForAdmin(): Promise<string> {
  const basic = Buffer.from(
    `${constants.REDDIT_APP_ID}:${constants.REDDIT_APP_SECRET}`
  ).toString("base64");

  const res = await axios.post(
    "https://www.reddit.com/api/v1/access_token",
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return res.data?.access_token as string;
}

/**
 * Reddit checker — Reddit API (NO browser).
 * NOTE: `SocialUrls.reddit` base is NOT used; the hardcoded oauth path is.
 */
export async function checkRedditUser(username: string): Promise<boolean> {
  try {
    const token = await getRedditTokenForAdmin();

    const res = await axios.get(`https://oauth.reddit.com/user/${username}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "YourApp/0.1 by YourUsername",
      },
    });

    return res.status === 200;
  } catch {
    // 404 and any other error → false
    return false;
  }
}
