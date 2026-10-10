# ADR 0005: Convert HEIC and HEIF Inputs in the Browser

## Status

Accepted

## Context

Many iPhone and macOS image workflows produce HEIC or HEIF files. Browser support for decoding and encoding these formats is inconsistent, while the app's core pipeline expects a browser-decodable bitmap source that can be drawn to canvas.

## Decision

Accept `.heic` and `.heif` inputs and attempt native browser decoding first. If unavailable, load the vendored `heic2any` converter and pass its PNG output through the canvas resize/export flow. Terminate the converter worker after each file to release buffers. When the output format is Same, export HEIC/HEIF as WebP when supported, or PNG otherwise; the app does not encode HEIC.

## Consequences

- Users can process common iPhone photo formats without uploading files to a server.
- HEIC/HEIF conversion adds download weight and extra client-side memory use.
- Multi-image HEIC/HEIF files are flattened to the first decoded image.
