// ---------------------------------------------------------------------------
// Edit this file after you finish the setup steps in README.md.
// These values are PUBLIC (anyone can read them). That is fine and expected:
// the OAuth client_id is designed to be public, and the client_secret never
// comes near this file -- it lives only in the Cloudflare Worker.
// ---------------------------------------------------------------------------
window.SHARE_FILES_CONFIG = {
  // From your GitHub OAuth App (README step 1).
  clientId: 'PASTE_YOUR_CLIENT_ID_HERE',

  // Your deployed Cloudflare Worker URL (README step 2).
  tokenProxy: 'https://PASTE-YOUR-WORKER.workers.dev',

  // The repo that actually STORES the files, as "owner/repo".
  // This one is private, so the files in it are private too.
  dataRepo: 'Deyeskay/share-files-data',

  // Branch to read and write. Must match the data repo's default branch.
  branch: 'main',

  // Subfolder inside the repo where files live. Empty means the repo root,
  // which is what we want: this repo holds nothing but your files.
  basePath: '',
};
