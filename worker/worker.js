/**
 * GitHub OAuth token exchange for the share-files static site.
 *
 * A GitHub Pages site cannot do this itself for two reasons:
 *   1. https://github.com/login/oauth/access_token sends no CORS headers, so a
 *      browser cannot call it.
 *   2. The exchange needs the OAuth client_secret, which must never be shipped
 *      in client-side code.
 *
 * This Worker is the smallest thing that closes that gap. It accepts a POST
 * with { code, redirect_uri }, performs the exchange server-side, and returns
 * the access token to an allow-listed origin.
 *
 * Secrets / vars (see wrangler.toml and README step 2):
 *   GITHUB_CLIENT_ID      var    - public OAuth app client id
 *   GITHUB_CLIENT_SECRET  secret - set with `wrangler secret put`, never in git
 *   ALLOWED_ORIGINS       var    - comma-separated origins allowed to call this
 */

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = request.headers.get('Origin') || '';
    const allowOrigin = allowed.includes(origin) ? origin : null;

    const headers = {
      'Access-Control-Allow-Origin': allowOrigin || 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    const json = (body, status) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // Restricting the origin keeps this from becoming an open token-minting
    // endpoint that any site could point at your OAuth app.
    if (!allowOrigin) {
      return json({ error: 'origin_not_allowed', error_description: 'Origin ' + origin + ' is not in ALLOWED_ORIGINS.' }, 403);
    }
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return json({ error: 'server_not_configured', error_description: 'GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing on the Worker.' }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (!payload || typeof payload.code !== 'string' || !payload.code) {
      return json({ error: 'missing_code' }, 400);
    }

    let ghRes;
    try {
      ghRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: payload.code,
          ...(payload.redirect_uri ? { redirect_uri: payload.redirect_uri } : {}),
        }),
      });
    } catch (e) {
      return json({ error: 'upstream_unreachable', error_description: String(e) }, 502);
    }

    let data;
    try {
      data = await ghRes.json();
    } catch {
      return json({ error: 'upstream_bad_response' }, 502);
    }

    if (data.error) {
      return json(
        { error: data.error, error_description: data.error_description || '' },
        400,
      );
    }
    if (!data.access_token) {
      return json({ error: 'no_token_returned' }, 502);
    }

    // Return only the token, not the whole upstream payload.
    return json({ access_token: data.access_token, scope: data.scope || '' }, 200);
  },
};
