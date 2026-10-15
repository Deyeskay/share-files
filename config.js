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
  // Use a PRIVATE repo here if you want the files to be private.
  dataRepo: 'Deyeskay/share-files',

  // Branch to read and write.
  branch: 'main',

  // Subfolder inside the repo where files live. Keeps uploads from sitting
  // next to the app's own index.html. Set to '' to use the repo root.
  basePath: 'files',
};
