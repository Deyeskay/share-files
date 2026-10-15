// ---------------------------------------------------------------------------
// The only file you need to edit.
//
// Nothing secret belongs here. Your access token is never stored in this file;
// you paste it into the page itself and it stays in your browser.
// ---------------------------------------------------------------------------
window.SHARE_FILES_CONFIG = {
  // The repo that stores the files, as "owner/repo".
  // This one is private, so the files in it are private too.
  dataRepo: 'Deyeskay/share-files-data',

  // Branch to read and write. Must match the data repo's default branch.
  branch: 'main',

  // Subfolder inside the repo where files live. Empty means the repo root,
  // which is what we want: this repo holds nothing but your files.
  basePath: '',
};
