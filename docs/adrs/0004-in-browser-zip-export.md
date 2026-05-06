# ADR 0004: Generate ZIP Downloads in the Browser Without Runtime Dependencies

## Status

Accepted

## Context

Users need one-click download for completed batches. Adding a ZIP dependency would be reasonable, but the current ZIP needs are narrow: store already-compressed image blobs, preserve unique output names, and download a single archive.

## Decision

Generate ZIP files in `app.js` using in-browser Blob construction, CRC32 calculation, local file headers, central directory headers, and end-of-central-directory records. Do not add a runtime ZIP library for the current scope.

## Consequences

- The app keeps zero runtime dependencies.
- ZIP generation is transparent and tailored to the app's needs.
- The implementation should stay focused on simple stored entries; adding compression methods, directories, comments, or ZIP64 support would require revisiting this decision.
