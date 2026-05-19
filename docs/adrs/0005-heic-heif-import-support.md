# ADR 0005: Convert HEIC and HEIF Inputs in the Browser

## Status

Accepted

## Context

Many iPhone and macOS image workflows produce HEIC or HEIF files. Browser support for decoding and encoding these formats is inconsistent, while the app's core pipeline expects a browser-decodable bitmap source that can be drawn to canvas.

## Decision

Accept `.heic` and `.heif` inputs and convert them in the browser with the vendored `heic2any` library before passing them through the existing canvas resize/export flow. When the output format is Same, HEIC and HEIF files export as WebP because browsers generally cannot encode HEIC from canvas.

## Consequences

- Users can process common iPhone photo formats without uploading files to a server.
- HEIC/HEIF conversion adds download weight and extra client-side memory use.
- Multi-image HEIC/HEIF files are flattened to the first decoded image.
