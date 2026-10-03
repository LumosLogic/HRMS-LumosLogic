// Cache headers for the built frontend served by express.static.
//   *.html                      never cached (it names the current hashed bundles)
//   /assets/<name>-<hash>.<ext> content-addressed build output (Vite) → cache for a year, immutable. Measured on production
//                               before this: "public, max-age=0" + ETag, i.e. every page load revalidated every JS/CSS file.
//   everything else             unchanged (Express default: ETag + max-age=0)
const HASHED_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

function setStaticHeaders(res, filePath) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else if (HASHED_ASSET.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

module.exports = { setStaticHeaders, HASHED_ASSET };
