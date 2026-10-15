# share-files

A static web page, hosted on GitHub Pages at
<https://deyeskay.github.io/share-files>, that signs you in with GitHub and lets
you **upload**, **download** and **remove** files in a GitHub repo.

No backend, no database. The files live as ordinary files in a repo; the page
talks straight to the GitHub REST API from your browser.

---

## Read this first: why there are two repos

You asked for the files to be private. There is a catch, straight from
[GitHub's docs](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site):

> GitHub Pages sites are publicly available on the internet, even if the
> repository for the site is private (if your plan or organization allows it).

Two consequences:

1. Publishing Pages **from a private repo needs a paid plan** (GitHub Pro or
   higher). On the free plan, making `share-files` private switches the site
   off and `deyeskay.github.io/share-files` goes dead.
2. Even on a paid plan, the **published page is public anyway**. Making the
   repo private would not hide the page — only the files.

So the setup splits the two jobs:

| Repo | Visibility | Holds |
|---|---|---|
| `Deyeskay/share-files` | **public** | this app (`index.html`, `app.js`, `styles.css`) |
| `Deyeskay/share-files-data` | **private** | your actual uploaded files |

The public repo has no files of yours in it, and the page in it is harmless to
expose — it contains no secrets. Your files sit in the private repo, reachable
only with your signed-in token.

If you would rather keep everything in one public repo, that works too: leave
`dataRepo` pointing at `Deyeskay/share-files` and skip step 0. Uploads then
land in the `files/` subfolder. Just know they are world-readable.

---

## Setup

Four steps, about 15 minutes. Do them in order.

### Step 0 — Create the private data repo

On GitHub, create a new **private** repo named `share-files-data`.
Tick "Add a README" so the repo is not empty (an empty repo has no branch, and
the app needs a branch to write to).

> Your existing `robot.zip` is currently in the public `share-files` repo. If
> you want it private, download it and re-upload it through the app once setup
> is done, then delete it from the public repo.

### Step 1 — Register a GitHub OAuth App

This is what makes the "Sign in with GitHub" button real.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name**: `share-files`
   - **Homepage URL**: `https://deyeskay.github.io/share-files/`
   - **Authorization callback URL**: `https://deyeskay.github.io/share-files/`
     (the trailing slash matters; GitHub accepts any sub-path of it)
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy it. You only see it once.

### Step 2 — Deploy the token-exchange Worker

GitHub's token endpoint sends no CORS headers and the exchange needs your client
secret, so a static page cannot do this itself. `worker/worker.js` is the
smallest piece that can. It is free on Cloudflare's plan.

```bash
cd worker

# 1. Put your Client ID in wrangler.toml (GITHUB_CLIENT_ID).
#    ALLOWED_ORIGINS is already set to https://deyeskay.github.io

# 2. Log in to Cloudflare (opens a browser).
npx wrangler login

# 3. Deploy. Note the https://share-files-oauth.<you>.workers.dev URL it prints.
npx wrangler deploy

# 4. Store the client secret. It is encrypted at Cloudflare and never in git.
npx wrangler secret put GITHUB_CLIENT_SECRET
```

### Step 3 — Fill in `config.js`

Edit [config.js](config.js) in this repo:

```js
window.SHARE_FILES_CONFIG = {
  clientId:   'Iv1.abc123...',                              // from step 1
  tokenProxy: 'https://share-files-oauth.you.workers.dev',  // from step 2
  dataRepo:   'Deyeskay/share-files-data',                  // the private repo
  branch:     'main',
  basePath:   '',       // '' = repo root. Use 'files' if dataRepo is this repo.
};
```

Until you do this, the page shows a "Finish the setup first" notice instead of
failing silently.

### Step 4 — Turn on GitHub Pages

Push this repo, then in `Deyeskay/share-files` → **Settings** → **Pages**:
set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`.

Give it a minute, then open <https://deyeskay.github.io/share-files/>.

---

## Using it

- **Upload** — drag files onto the dashed box, or click *choose files*. Multiple
  at once is fine. Uploading a name that already exists replaces it.
- **Download** — click *Download*. Works on private repos, because the file is
  fetched with your token rather than via a public URL.
- **Remove** — click *Remove* and confirm.
- **Folders** — click a folder name to go in; use the breadcrumb to come back.

Your sign-in is remembered in this browser's `localStorage`, so you only sign in
once per browser. *Sign out* clears it.

---

## Security notes

**The `repo` scope is broad.** OAuth Apps only support GitHub's classic scopes,
and `repo` is the narrowest one that can write to a private repo. It grants the
token access to *all* your repos, not just this one. The token stays in your own
browser and is sent only to `api.github.com`, but you should know that is the
blast radius. Scoping to a single repo would mean building this as a GitHub App
instead — more setup, and worth it only if you care about that difference.

**The Worker is origin-locked.** `ALLOWED_ORIGINS` in `wrangler.toml` means only
your Pages site can call it. Without that, any site could use your OAuth app to
mint tokens.

**Login CSRF is handled.** The app generates a random `state` before redirecting
and refuses any callback whose `state` does not match, so a crafted link cannot
sign you into someone else's account.

**Deleted files stay in git history.** *Remove* makes a commit that deletes the
file; the content is still recoverable from earlier commits. For a true purge
you have to rewrite history. Treat *Remove* as "take it off the list", not
"destroy it".

**Never commit the client secret.** It belongs only in
`wrangler secret put`. `worker/.gitignore` covers `.dev.vars` for local runs.

---

## Limits

| Thing | Limit |
|---|---|
| Single file | 100 MB (GitHub API hard limit; the app blocks above this) |
| Comfortable file size | ~25 MB — above that the app warns, since uploads are base64 (+33%) |
| Repo size | GitHub recommends staying under 5 GB |
| API requests | 5,000/hour per user |

This is backed by a git repo, so it suits documents and archives. It is not a
good home for large media or files you change many times a day — every upload
is a commit, and every version is kept forever.

## Local development

```bash
npx http-server -p 8080 -c-1 .
```

Then add `http://localhost:8080` to `ALLOWED_ORIGINS` in `worker/wrangler.toml`,
redeploy the Worker, and add `http://localhost:8080/` as a second OAuth app
callback URL (or register a separate OAuth app for local use).

## Files

| File | Purpose |
|---|---|
| [index.html](index.html) | Page structure and the three views |
| [app.js](app.js) | OAuth flow, GitHub API calls, rendering |
| [styles.css](styles.css) | Styling, light and dark |
| [config.js](config.js) | The only file you edit after setup |
| [worker/worker.js](worker/worker.js) | Cloudflare Worker: OAuth token exchange |
| [worker/wrangler.toml](worker/wrangler.toml) | Worker config and public vars |
| `.nojekyll` | Stops GitHub Pages running the files through Jekyll |
