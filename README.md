# Bulk Image Size Reducer

A local browser tool for batch reducing image sizes. Drop many images at once, choose JPEG, WebP, PNG, or same-format output, set quality and max dimensions, then download individual results or one ZIP.

## Run locally

```sh
npm start
```

Then open:

```text
http://127.0.0.1:4173
```

No dependencies are required. The server only serves the static files in this folder.

## Notes

- Processing happens locally in the browser.
- JPEG, PNG, and WebP export use the browser canvas encoder.
- Animated GIFs and animated WebP files are flattened to the first decoded frame.
- Canvas export strips most metadata by default.
