# ADR 0002: Keep the App Deployable as a Static Site

## Status

Accepted

## Context

Bulk Image Size Reducer is a single-page browser tool. It does not need user accounts, a database, a remote API, or server-side image processing for the current feature set.

## Decision

The production deployment target is any static host that can serve `index.html`, `styles.css`, `app.js`, and assets in `docs/`. The included `server.mjs` is only a local development server.

## Consequences

- The app can be hosted on Cloudflare Pages, GitHub Pages, Netlify, Vercel, or any plain static host.
- Deployment and rollback are straightforward because there is no backend runtime to coordinate.
- Features that need persistence, authentication, or remote processing should be evaluated with a new ADR before adding backend infrastructure.
