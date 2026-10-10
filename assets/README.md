# Asset Sources

Sample photos are bundled so using the demo does not contact an image service. The app loads small thumbnails initially; full-size samples are fetched from the same host only when requested. Thumbnails are derived from the corresponding photographs.

- Alpine lake: [Unsplash photo-1470770841072-f978cf4d019e](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- Forest light: [Unsplash photo-1441974231531-c6227db76b6e](https://images.unsplash.com/photo-1441974231531-c6227db76b6e)
- Mountain ridge: [Unsplash photo-1464822759023-fed622ff2c3b](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b)

Photo source terms: [Unsplash License](https://unsplash.com/license).

UI icons are static SVG assets from [Lucide](https://lucide.dev/). The upstream license is retained in [icons/LICENSE](icons/LICENSE). No icon-library runtime is shipped.

The custom brand mark uses progressively smaller image frames. It is stored as a lightweight SVG in `brand-mark.svg`.

The Inter variable typeface is bundled from the [Inter project](https://github.com/rsms/inter). Its SIL Open Font License is retained in [fonts/LICENSE.txt](fonts/LICENSE.txt). Fonts are served from this app's host, without a third-party font request.
