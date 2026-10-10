# Product-Quality Audit

Scope: the browser product, before any native wrapper or store submission. No accounts, billing or cloud image processing were added. This document records the fixes and verification for the browser release.

## Findings and Fixes

| Severity | Observed issue | Resolution |
| --- | --- | --- |
| Blocking | WebKit could display WebP but silently exported PNG when WebP encoding was requested. | Detect export capability; disable unsupported WebP, use JPEG presets, verify actual output MIME. |
| Blocking | In-flight settings/removal changes could produce inconsistent results. | Lock mutations during operations, keep a stable batch, stop between files, preserve completed outputs. |
| Important | Hidden empty state stayed visible after importing. | Make `hidden` authoritative; test empty, imported, complete and cleared states. |
| Important | Partial batch savings compared against unprocessed inputs. | Calculate savings only from completed originals; distinguish larger outputs and partial progress. |
| Important | Bad inputs, decode failures and ZIP failures had insufficient recovery. | Explain rejected files, retry failed files only, retain downloadable results, handle converter load failure/timeouts. |
| Important | HEIC errors obscured the actual cause; optional previews could invalidate exports. | Preserve downstream error messages and keep successful exports when only comparison generation fails. |
| Important | Large outputs and HEIC decoder buffers could accumulate. | Bound input/output sizes and dimensions, process sequentially, close bitmaps, release URLs, terminate converter workers. |
| Important | ZIP filenames could collide or contain path characters. | Sanitize flat names and resolve case-insensitive collisions; validate real archives with `unzip`. |
| Important | No useful original/result inspection. | Add accessible comparison dialog with fit and 100% modes, keyboard-scrolling regions and individual download. |
| Important | Phone settings, input sizing and destructive actions needed work. | Fully exposed settings, 44 px controls, 16 px phone inputs, clear confirmation, focus recovery and reduced-motion support. |
| Important | Starting compression sent keyboard focus to the page; repeated status mutations could create announcement noise. | Keep focus on Stop during processing, retain it while stopping, then move to Retry/Download. Only mutate live status text when it changes. |
| Important | A 48-megapixel source was rejected even when the requested output was small. | Separate 64 MP source and 32 MP output limits; verify real decoding and reduction of a generated 8000 by 6000 JPEG. |
| Important | Unicode-equivalent, reserved and long names were not portable across filesystem destinations. | Normalize names, prefix reserved device names, preserve UTF-8 character boundaries and leave room for collision suffixes under the filename byte limit. |
| Polish | Generic oversized layout and weak first-use feedback. | Compact workspace, real sample photos, clear queue summaries, presets, filename preview and state-aware primary download action. |
| Polish | A separate logo/header strip repeated the product identity and pushed the workspace down. | Replace it and the slogan with a single compact product title; verify the image picker remains unobstructed in the first viewport at 320 by 640 px. |
| Polish | Settings on the right, collapsed mobile controls and casual status copy did not match the approved product direction. | Put desktop settings on the left, expose mobile controls directly, retain Process batch, and use factual status text with a compact custom mark and self-hosted typography. |

## Verification

- `npm test`: Chrome and Playwright WebKit on macOS; see the test output for the current run count.
- Real JPEG/PNG/WebP/AVIF processing, alpha pixel checks, resize/no-upscale, actual HEIC conversion, corrupt files, duplicate imports, format fallback, stop/resume, preview, clear and download flows.
- Full 100-image batches in both engines, with responsive timer callbacks during processing and all 100 entries validated in the downloaded ZIP. This is a repeatable desktop test, not a universal device-capacity benchmark.
- Pixel-level assertions cover all eight EXIF rotations/reflections, plus large-source resizing, output-limit recovery, Unicode filename collisions and HTML-like names rendered as plain text.
- Network assertions distinguish same-origin `blob:` previews from network requests and reject uploads or third-party requests during the batch.
- Injected converter/ZIP/preview failures and size-limit conditions test recovery without exhausting the test machine's memory.
- Automated WCAG A/AA checks at 320, 390, 768 and 1440 px, including completed results and the comparison dialog. These complement, not replace, manual assistive-technology testing.
- Actual browser screenshots reviewed for empty, complete and comparison states; additional fit checks cover phone landscape and 1920 px desktop.

## Remaining Release Checks

Before describing a future native release as ready, test the real target devices: iOS Photos/Files imports, Android document providers, download/share destinations, screen readers, app backgrounding and memory pressure. Browser-engine emulation does not establish native-wrapper behavior or store approval. The current product has no persistent queue or background processing guarantee.

Guardrails and format constraints are documented in the README. In particular, low-memory phones may need smaller batches, HEIC variants can differ, originals above 64 megapixels are rejected, and image quality/size vary by browser encoder. No iOS Simulator runtime is installed on the development machine; WebKit testing is not a substitute for actual iOS device behavior.
