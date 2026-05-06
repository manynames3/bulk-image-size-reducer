# ADR 0003: Use Browser Canvas Encoding for Image Output

## Status

Accepted

## Context

The app needs to resize images and export WebP, JPEG, PNG, or the supported original format. Codec libraries such as the Squoosh codecs can provide more tuning options, but they add download weight and implementation complexity.

## Decision

Use browser image decode APIs and canvas export:

- `createImageBitmap` when available, with an `Image` element fallback.
- A canvas sized to the requested output dimensions.
- `canvas.toBlob` for JPEG, PNG, and WebP export.

## Consequences

- The app remains dependency-free and fast to load.
- Output behavior follows each browser's encoder implementation.
- Advanced codec controls are outside the current scope.
- Metadata is not preserved because canvas export strips most metadata by default.
