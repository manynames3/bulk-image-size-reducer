# ADR 0001: Process Selected Images Entirely in the Browser

## Status

Accepted

## Context

The app reduces batches of user-selected images. Those files can be personal, large, or numerous. A server-side processing pipeline would require uploads, storage handling, queueing, retention rules, and operational controls.

## Decision

All image decode, resize, encode, preview, and download work happens in the user's browser. The project does not include an application server, upload endpoint, hosted storage bucket, or remote image processing worker.

## Consequences

- User-selected files remain on the user's device.
- Hosting stays simple because the production app is static.
- Performance and batch size are bounded by the user's browser, device memory, and canvas implementation.
- The app cannot provide server-side batch history, shared assets, or background processing without a future architecture change.
