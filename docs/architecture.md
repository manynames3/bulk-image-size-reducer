# Architecture

Bulk Image Size Reducer is a static, browser-only image compression app. Its primary architectural constraint is that selected files stay local to the user's device: the app serves HTML, CSS, JavaScript, vendored browser dependencies, and documentation assets, then all image processing runs in the browser.

## C4 Container Diagram

```mermaid
flowchart TB
  user["Person\nUses the app to reduce batches of image files"]

  subgraph browser["Web Browser"]
    ui["Static App Shell\nindex.html + styles.css"]
    controller["Batch Processing Controller\napp.js"]
    heicConverter["HEIC/HEIF Converter\nvendored heic2any"]
    fileApis["Browser File APIs\nFile, Blob, Object URL, downloads"]
    imagePipeline["Image Pipeline\ncreateImageBitmap/Image, Canvas, canvas.toBlob"]
    zipWriter["ZIP Writer\nCRC32 + ZIP headers in app.js"]
  end

  host["Static Web Host\nCloudflare Pages, GitHub Pages, Netlify, Vercel, or any static host"]
  devServer["Local Dev Server\nserver.mjs"]
  localFiles["Local Image Files\nUser-selected inputs and downloaded outputs"]

  user -->|"opens app"| host
  user -->|"runs npm start"| devServer
  host -->|"serves static assets"| ui
  devServer -->|"serves static assets"| ui
  user -->|"selects or drops images"| ui
  ui --> controller
  controller --> fileApis
  controller --> heicConverter
  heicConverter -->|"PNG Blob for HEIC/HEIF inputs"| imagePipeline
  controller --> imagePipeline
  controller --> zipWriter
  fileApis <--> localFiles
  imagePipeline -->|"compressed Blob outputs"| fileApis
  zipWriter -->|"batch ZIP Blob"| fileApis
```

## Runtime Flow

1. The user opens the static app from a host or the local development server.
2. The browser loads `index.html`, `styles.css`, `app.js`, and the vendored HEIC/HEIF converter.
3. The user drops or selects image files. The app accepts browser image files plus `.heic` and `.heif` inputs, creates preview object URLs where the browser can render them, and tracks queue state in memory.
4. The user chooses output format, quality, max dimensions, suffix, and no-upscale behavior.
5. `app.js` decodes each image with `createImageBitmap`, falling back to an `Image` element when needed. HEIC/HEIF inputs are first converted in-browser to a PNG Blob by `heic2any`.
6. The app draws each image to a canvas at the target dimensions and exports a Blob with `canvas.toBlob`.
7. The user downloads individual output files or a ZIP built in memory by the app's ZIP writer.

## Deployment Shape

The production app is a static site. The local server exists only for development convenience and serves files from the project root with `no-store` caching. No production API, database, object storage bucket, worker queue, or server-side image processor is required.

## Key Constraints

- Processing large batches depends on browser memory and canvas limits.
- Browser encoders decide final compression behavior, so output can vary across browsers.
- HEIC/HEIF support depends on the vendored browser converter and adds extra client-side memory pressure during conversion.
- Canvas export strips most metadata by default.
- Animated and multi-image inputs are flattened to the first decoded frame/image.
