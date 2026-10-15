# share-files

A static web page, hosted on GitHub Pages at
<https://deyeskay.github.io/share-files>, that lets you **upload**, **download**
and **remove** files in a private GitHub repo from your browser.

No backend, no database, no third-party service. The files are ordinary files in
a repo; the page talks straight to the GitHub REST API.

---

## How it is arranged

Two repos, because GitHub Pages forces the split. Straight from
[GitHub's docs](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site):

> GitHub Pages sites are publicly available on the internet, even if the
> repository for the site is private (if your plan or organization allows it).

So a private repo cannot give you a private page, and on the free plan it cannot
give you a page at all. The two jobs are therefore separated:

| Repo | Visibility | Holds |
|---|---|---|
| `Deyeskay/share-files` | **public** | this app — `index.html`, `app.js`, `styles.css` |
| `Deyeskay/share-files-data` | **private** | your actual files |

The public repo contains no files of yours and no secrets, so exposing it costs
nothing. Your files live in the private repo, reachable only with your token.

## Why a token and not a "Sign in with GitHub" button

A login button sounds nicer, but it cannot work on GitHub Pages alone. Turning
GitHub's OAuth code into a token requires a POST to
`github.com/login/oauth/access_token` carrying your app's **client secret**, and:

1. that endpoint sends no CORS headers, so a browser cannot call it, and
2. the secret would have to ship inside `app.js`, readable by anyone.

A login button therefore needs a second always-on service just to perform that
exchange. A personal access token skips all of it — and is **more** narrowly
scoped, because a fine-grained token can be limited to this one repo, while
OAuth Apps only offer the classic `repo` scope covering every repo you own.

---

## Setup

### Step 1 — Create the token

1. Go to <https://github.com/settings/personal-access-tokens/new>.
   GitHub may ask you to confirm your identity first; that is normal.
2. Fill in:
   - **Token name**: `share-files`
   - **Expiration**: your call. 90 days is a reasonable balance; when it lapses
     the page says so plainly and you paste a fresh one.
   - **Resource owner**: `Deyeskay`
   - **Repository access**: *Only select repositories* → pick
     **`share-files-data`**. Do not grant "All repositories".
   - **Permissions** → *Repository permissions* → **Contents**:
     **Read and write**. Leave everything else alone. (Metadata becomes
     read-only automatically; that is expected and required.)
3. **Generate token** and copy it. It is shown once.

### Step 2 — Connect

Open <https://deyeskay.github.io/share-files/>, paste the token, click
**Connect**. The page checks the token can actually reach
`share-files-data` before saving it, so a mis-scoped token is caught right away
rather than failing later on your first upload.

The token is stored in this browser's `localStorage`. You paste it once per
browser. **Sign out** erases it.

### Step 3 — Turn on GitHub Pages

In `Deyeskay/share-files` → **Settings** → **Pages**: set **Source** to
*Deploy from a branch*, branch `main`, folder `/ (root)`. Wait a minute, then
load the URL.

---

## Using it

- **Upload** — drag files onto the dashed box, or click *choose files*. Several
  at once is fine. Uploading a name that already exists replaces it.
- **Download** — click *Download*. Works on a private repo because the file is
  fetched with your token rather than from a public URL.
- **Remove** — click *Remove* and confirm.
- **Folders** — click a folder to enter it; use the breadcrumb to go back.

---

## Security notes

**The token is scoped to one repo.** A fine-grained token limited to
`share-files-data` with Contents access cannot touch your other repos, cannot
change settings, and cannot act on your behalf elsewhere.

**It lives only in your browser.** It is kept in `localStorage` for this origin
and attached only to `api.github.com` requests. It is never committed, never
sent anywhere else, and is not in this repo. Anyone with access to your unlocked
browser profile could read it, which is the main thing to be aware of — on a
shared machine, click *Sign out* when done.

**Deleted files stay in git history.** *Remove* commits a deletion; the content
is still recoverable from earlier commits. For a real purge you must rewrite
history. Treat *Remove* as "take it off the list", not "destroy it".

**If a token leaks**, revoke it at
<https://github.com/settings/personal-access-tokens> and generate a new one.
Nothing else needs changing.

---

## Limits

| Thing | Limit |
|---|---|
| Single file | 100 MB (GitHub API hard limit; the app blocks above this) |
| Comfortable file size | ~25 MB — above that the app warns, since uploads are base64 (+33%) |
| Repo size | GitHub recommends staying under 5 GB |
| API requests | 5,000/hour |

This is backed by a git repo, so it suits documents and archives. It is a poor
home for large media or files you rewrite many times a day — every upload is a
commit, and every version is kept forever.

## Local development

```bash
npx http-server -p 8080 -c-1 .
```

Then open <http://localhost:8080>. No extra configuration is needed; the same
token works, since everything happens against `api.github.com` directly.

## Files

| File | Purpose |
|---|---|
| [index.html](index.html) | Page structure and the three views |
| [app.js](app.js) | Token handling, GitHub API calls, rendering |
| [styles.css](styles.css) | Styling, light and dark |
| [config.js](config.js) | The only file you edit — repo, branch, subfolder |
| `.nojekyll` | Stops GitHub Pages running the files through Jekyll |
