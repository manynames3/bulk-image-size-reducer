const state = {
  items: [],
  processing: false,
  buildingZip: false,
  importing: false,
  cancel: false,
  previewId: null,
};
const $ = (id) => document.getElementById(id);
const els = {
  dropZone: $("drop-zone"),
  fileInput: $("file-input"),
  browseButton: $("browse-button"),
  settingsForm: $("settings-form"),
  quality: $("quality"),
  qualityOutput: $("quality-output"),
  maxWidth: $("max-width"),
  maxHeight: $("max-height"),
  suffix: $("filename-suffix"),
  noUpscale: $("no-upscale"),
  processButton: $("process-button"),
  zipButton: $("zip-button"),
  clearButton: $("clear-button"),
  queueList: $("queue-list"),
  emptyState: $("empty-state"),
  queueStatus: $("queue-status"),
  progress: $("batch-progress"),
  metricCount: $("metric-count"),
  metricSize: $("metric-size"),
  metricSaved: $("metric-saved"),
};
const encoder = new TextEncoder();
const crcTable = buildCrcTable();
const heicMimeTypes = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const MAX_FILE = 50 * 1024 * 1024;
const MAX_BATCH = 500 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 64_000_000;
const MAX_PIXELS = 32_000_000;
const probe = document.createElement("canvas");
probe.width = probe.height = 1;
const supportsWebP = probe
  .toDataURL("image/webp")
  .startsWith("data:image/webp");
probe.width = probe.height = 0;
const defaultFormat = supportsWebP ? "webp" : "jpeg";
if (!supportsWebP) {
  const webpOption = els.settingsForm.querySelector('[value="webp"]');
  webpOption.disabled = true;
  webpOption.closest("label").title =
    "WebP export is unavailable in this browser";
  els.settingsForm.querySelector('[value="jpeg"]').checked = true;
  els.quality.value = "60";
}
const rows = new Map();
const busy = () => state.processing || state.buildingZip || state.importing;
const icon = (name) => `<i class="icon ${name}" aria-hidden="true"></i>`;
els.browseButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  addFiles(els.fileInput.files);
  els.fileInput.value = "";
});
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  els.dropZone.classList.remove("dragover");
  addFiles(event.dataTransfer.files);
});
els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragover");
});
els.dropZone.addEventListener("dragleave", (event) => {
  if (!els.dropZone.contains(event.relatedTarget))
    els.dropZone.classList.remove("dragover");
});
els.settingsForm.addEventListener("submit", (event) => event.preventDefault());
els.settingsForm.addEventListener("input", (event) => {
  if (busy()) return;
  if (event.target.id !== "filename-suffix" && event.target.id !== "preset") {
    $("preset").value = "custom";
    markQueued();
  }
  updateSettings();
  render();
});
$("preset").addEventListener("change", () => {
  if (busy()) return;
  const presets = {
    web: [supportsWebP ? 82 : 60, 1920],
    small: [supportsWebP ? 65 : 50, 1280],
    detail: [supportsWebP ? 92 : 80, ""],
  };
  const preset = presets[$("preset").value];
  if (!preset) return;
  els.settingsForm.querySelector(`[value="${defaultFormat}"]`).checked = true;
  [els.quality.value, els.maxWidth.value] = preset;
  els.maxHeight.value = "";
  els.noUpscale.checked = true;
  markQueued();
  updateSettings();
  render();
});
els.processButton.addEventListener("click", processAll);
els.zipButton.addEventListener("click", downloadZip);
els.clearButton.addEventListener("click", () => {
  if (!busy()) $("clear-dialog").showModal();
});
$("confirm-clear").addEventListener("click", () => {
  $("clear-dialog").close();
  clearQueue();
  els.browseButton.focus();
});
$("cancel-button").addEventListener("click", () => {
  $("cancel-button").focus({ preventScroll: true });
  if (state.cancel) return;
  state.cancel = true;
  render();
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => $(button.dataset.close).close());
});
$("preview-dialog").addEventListener("close", () => {
  $("preview-original").removeAttribute("src");
  $("preview-result").removeAttribute("src");
  state.previewId = null;
});
for (const name of ["original", "result"]) {
  const image = $(`preview-${name}`);
  const loading = $(`preview-${name}-loading`);
  image.addEventListener("load", () => {
    loading.hidden = true;
    image.parentElement.setAttribute("aria-busy", "false");
  });
  image.addEventListener("error", () => {
    if (!image.getAttribute("src")) return;
    loading.textContent =
      "Preview unavailable. The download is still available.";
    loading.hidden = false;
    image.parentElement.setAttribute("aria-busy", "false");
  });
}
document.querySelectorAll('[name="preview-scale"]').forEach((input) => {
  input.addEventListener("change", () => {
    $("preview-dialog").classList.toggle(
      "actual-size",
      input.value === "actual",
    );
    document.querySelectorAll(".preview-image").forEach((pane) => {
      pane.scrollTop = pane.scrollLeft = 0;
    });
  });
});
$("preview-download").addEventListener("click", () => {
  const item = state.items.find((entry) => entry.id === state.previewId);
  if (item?.outputBlob)
    downloadBlob(item.outputBlob, getOutputName(item, item.outputMime));
});
els.queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const item = state.items.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === "remove") removeItem(item.id);
  if (button.dataset.action === "preview") showPreview(item);
  if (button.dataset.action === "download" && item.outputBlob)
    downloadBlob(item.outputBlob, getOutputName(item, item.outputMime));
});
$("sample-button").addEventListener("click", async () => {
  if (busy()) return;
  state.importing = true;
  render();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const names = ["alpine-lake", "forest-light", "mountain-ridge"];
    const files = await Promise.all(
      names.map(async (name) => {
        const response = await fetch(`./assets/samples/${name}.jpg`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Sample photos could not load. Choose your own images or try again.",
          );
        return new File([await response.blob()], `${name}.jpg`, {
          type: "image/jpeg",
          lastModified: 1,
        });
      }),
    );
    state.importing = false;
    addFiles(files);
  } catch {
    announce(
      "Sample photos could not load. Choose your own images or try again.",
      true,
    );
  } finally {
    clearTimeout(timeout);
    controller.abort();
    state.importing = false;
    render();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.items.length) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function announce(message, error = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("error", error);
}
function settingsError() {
  for (const input of [els.maxWidth, els.maxHeight]) {
    if (!input.validity.valid)
      return "Enter whole dimensions between 1 and 8192 px, or leave blank.";
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(els.suffix.value))
    return "The suffix cannot contain slashes or reserved filename characters.";
  return "";
}
function updateSettings() {
  const format = els.settingsForm.querySelector(
    '[name="format"]:checked',
  ).value;
  const lossless = format === "png";
  els.quality.disabled = lossless || busy();
  els.qualityOutput.value = lossless ? "Lossless" : `${els.quality.value}%`;
  $("format-note").textContent = {
    webp: "WebP supports transparency.",
    jpeg: supportsWebP
      ? "JPEG fills transparent areas with white."
      : "WebP export is unavailable here. JPEG fills transparency with white; choose PNG to keep it.",
    png: "PNG is lossless. The quality slider does not apply.",
    same: supportsWebP
      ? "JPEG, PNG and WebP keep their format. HEIC, HEIF and AVIF export as WebP."
      : "JPEG and PNG keep their format. Other inputs export as PNG to preserve transparency.",
  }[format];
  $("settings-short").textContent =
    `${format === "same" ? "Same" : format === "webp" ? "WebP" : format.toUpperCase()} · ${lossless ? "Lossless" : els.quality.value + "%"}`;
  $("filename-preview").textContent = getOutputName(
    { file: { name: "photo.jpg" } },
    format === "same" ? "image/jpeg" : `image/${format}`,
  );
  const error = settingsError();
  for (const input of [els.maxWidth, els.maxHeight]) {
    input.setAttribute("aria-invalid", String(!input.validity.valid));
    input.setAttribute("aria-describedby", "settings-error");
  }
  els.suffix.setAttribute(
    "aria-invalid",
    String(/[<>:"/\\|?*\u0000-\u001f]/.test(els.suffix.value)),
  );
  els.suffix.setAttribute(
    "aria-describedby",
    "filename-preview settings-error",
  );
  $("settings-error").textContent = error;
  $("settings-error").hidden = !error;
}
function addFiles(fileList) {
  if (busy()) {
    announce("Wait for this operation to finish before adding more images.");
    return;
  }
  const keys = new Set(state.items.map((item) => fileKey(item.file)));
  let total = sum(state.items.map((item) => item.file.size));
  let added = 0,
    duplicates = 0;
  const rejected = [];
  for (const file of Array.from(fileList)) {
    if (!isAcceptedImageFile(file)) {
      rejected.push(
        `${file.name}: unsupported format. Use JPEG, PNG, WebP, HEIC, HEIF or AVIF.`,
      );
      continue;
    }
    if (!file.size) {
      rejected.push(`${file.name}: this file is empty.`);
      continue;
    }
    if (keys.has(fileKey(file))) {
      duplicates++;
      continue;
    }
    if (
      file.size > MAX_FILE ||
      total + file.size > MAX_BATCH ||
      state.items.length >= 500
    ) {
      rejected.push(
        `${file.name}: batch limit reached (50 MB per image, 500 MB or 500 images per batch).`,
      );
      continue;
    }
    state.items.push({
      id: createId(),
      file,
      previewUrl: isHeicFile(file) ? "" : URL.createObjectURL(file),
      outputBlob: null,
      outputUrl: null,
      outputMime: "",
      outputSize: 0,
      dimensions: "",
      status: "queued",
      error: "",
    });
    keys.add(fileKey(file));
    total += file.size;
    added++;
  }
  const messages = [];
  if (added)
    messages.push(`${added} ${added === 1 ? "image added" : "images added"}.`);
  if (duplicates)
    messages.push(
      `${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped.`,
    );
  if (rejected.length)
    messages.push(
      rejected.slice(0, 3).join(" ") +
        (rejected.length > 3
          ? ` Plus ${rejected.length - 3} more skipped files.`
          : ""),
    );
  announce(messages.join(" "), rejected.length > 0);
  render();
}
function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
async function processAll() {
  if (busy() || settingsError()) return;
  const batch = state.items.filter((item) => item.status !== "done");
  if (!batch.length) return;
  state.processing = true;
  state.cancel = false;
  announce("");
  setProgress(0, batch.length);
  render();
  $("cancel-button").focus({ preventScroll: true });
  let completed = 0;
  try {
    for (const item of batch) {
      if (state.cancel) break;
      await processItem(item);
      completed++;
      setProgress(completed, batch.length);
      render();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    const restoreFocus =
      document.activeElement === $("cancel-button") ||
      document.activeElement === document.body;
    state.processing = false;
    const failed = batch.filter((item) => item.status === "error").length;
    announce(
      state.cancel
        ? "Batch stopped. Completed images are ready to download; compress again to continue."
        : failed
          ? `${failed} image${failed === 1 ? "" : "s"} could not be processed. Completed results are still available. Retry or remove the failed files.`
          : "Batch complete. Review your results or download the ZIP.",
      failed > 0,
    );
    render();
    if (restoreFocus) {
      (els.processButton.disabled ? els.zipButton : els.processButton).focus({
        preventScroll: true,
      });
    }
  }
}
async function processItem(item) {
  revokeOutput(item);
  item.previewUnavailable = false;
  item.status = "processing";
  item.error = "";
  render();
  let source, canvas;
  try {
    source = await decodeImage(item.file);
    if (source.width * source.height > MAX_SOURCE_PIXELS)
      throw new Error(
        "This image exceeds 64 megapixels. Export a smaller original before importing.",
      );
    const target = getTargetSize(source.width, source.height);
    if (
      target.width * target.height > MAX_PIXELS ||
      target.width > 8192 ||
      target.height > 8192
    )
      throw new Error(
        "Output is too large. Set smaller dimensions (up to 8192 px and 32 megapixels).",
      );
    const requestedMime = getRequestedMime(item.file);
    canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", {
      alpha: requestedMime !== "image/jpeg",
    });
    if (!context)
      throw new Error(
        "Not enough memory to process this image. Try a smaller batch.",
      );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (requestedMime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(source.image, 0, 0, target.width, target.height);
    const blob = await canvasToBlob(
      canvas,
      requestedMime,
      getQuality(requestedMime),
    );
    if (blob.type !== requestedMime)
      throw new Error(
        "This browser cannot export the selected format. Choose JPEG or PNG.",
      );
    if (
      sum(state.items.map((entry) => entry.outputSize)) + blob.size >
      MAX_BATCH
    )
      throw new Error(
        "Results exceed the 500 MB batch limit. Download completed images, then use a smaller batch or choose JPEG/WebP.",
      );
    item.outputMime = blob.type;
    item.outputBlob = blob;
    item.outputSize = blob.size;
    item.outputUrl = URL.createObjectURL(blob);
    item.dimensions = `${target.width} × ${target.height}`;
    item.status = "done";
    if (!item.previewUrl) {
      const thumb = document.createElement("canvas");
      try {
        const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
        thumb.width = Math.max(1, Math.round(source.width * scale));
        thumb.height = Math.max(1, Math.round(source.height * scale));
        thumb
          .getContext("2d")
          .drawImage(source.image, 0, 0, thumb.width, thumb.height);
        item.previewUrl = URL.createObjectURL(
          await canvasToBlob(thumb, "image/png"),
        );
        item.previewIsProxy = true;
      } catch {
        // A comparison preview is optional; do not discard a successful export.
        item.previewUnavailable = true;
      } finally {
        thumb.width = thumb.height = 0;
      }
    }
  } catch (error) {
    revokeOutput(item);
    item.status = "error";
    item.error = error.message || "Unable to process this image.";
  } finally {
    source?.close?.();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
async function decodeImage(file) {
  if (!isHeicFile(file)) return decodeRasterImage(file);
  try {
    return await decodeRasterImage(file);
  } catch {
    return decodeHeicImage(file);
  }
}
async function decodeHeicImage(file) {
  // Tear down the vendor worker after each file so decoded pixel buffers cannot accumulate across a batch.
  let script, timer, workerUrl;
  const createURL = URL.createObjectURL;
  try {
    await new Promise((resolve, reject) => {
      script = document.createElement("script");
      script.src = "./vendor/heic2any/dist/heic2any.min.js";
      timer = setTimeout(
        () => reject(new Error("HEIC converter could not load.")),
        15000,
      );
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () =>
        reject(new Error("HEIC converter could not load."));
      URL.createObjectURL = function (blob) {
        const url = createURL.call(URL, blob);
        if (blob.type === "application/javascript") workerUrl = url;
        return url;
      };
      document.head.append(script);
    });
    URL.createObjectURL = createURL;
    const converted = await Promise.race([
      window.heic2any({ blob: file, toType: "image/png" }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("HEIC conversion timed out.")),
          60000,
        );
      }),
    ]);
    return await decodeRasterImage(
      Array.isArray(converted) ? converted[0] : converted,
    );
  } catch (error) {
    if (/could not load|timed out/.test(error.message || "")) throw error;
    throw new Error(
      "This HEIC/HEIF variant could not be decoded. Export it as JPEG from Photos and try again.",
    );
  } finally {
    clearTimeout(timer);
    URL.createObjectURL = createURL;
    window.__heic2any__worker?.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    delete window.heic2any;
    delete window.__heic2any__worker;
    script?.remove();
  }
}
function decodeRasterImage(file) {
  if ("createImageBitmap" in window)
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bitmap) => ({
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }))
      .catch(() => decodeImageElement(file));
  return decodeImageElement(file);
}
function decodeImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      image = new Image();
    const timer = setTimeout(() => {
      image.src = "";
      cleanup();
      reject(
        new Error(
          "Image decoding timed out. Try exporting the original again.",
        ),
      );
    }, 30000);
    function cleanup() {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      image.onload = image.onerror = null;
    }
    image.onload = () => {
      cleanup();
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close() {
          image.src = "";
        },
      });
    };
    image.onerror = () => {
      cleanup();
      reject(
        new Error(
          "This image could not be read. It may be damaged or use an unsupported codec.",
        ),
      );
    };
    image.src = url;
  });
}
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Export failed. Try smaller dimensions.")),
      mime,
      quality,
    ),
  );
}
function getRequestedMime(file) {
  const selected = els.settingsForm.querySelector(
    '[name="format"]:checked',
  ).value;
  if (selected !== "same") return `image/${selected}`;
  const mime =
    file.type.toLowerCase() ||
    {
      JPG: "image/jpeg",
      JPEG: "image/jpeg",
      PNG: "image/png",
      WEBP: "image/webp",
    }[getFileExtension(file.name)];
  if (!supportsWebP && !["image/jpeg", "image/png"].includes(mime))
    return "image/png";
  return ["image/jpeg", "image/png", "image/webp"].includes(mime)
    ? mime
    : "image/webp";
}
function getQuality(mime) {
  return mime === "image/png" ? undefined : Number(els.quality.value) / 100;
}
function getTargetSize(width, height) {
  let scale = Math.min(
    Number(els.maxWidth.value) > 0
      ? Number(els.maxWidth.value) / width
      : Infinity,
    Number(els.maxHeight.value) > 0
      ? Number(els.maxHeight.value) / height
      : Infinity,
  );
  if (!Number.isFinite(scale)) scale = 1;
  if (els.noUpscale.checked) scale = Math.min(scale, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
function markQueued() {
  if (busy()) return;
  for (const item of state.items) {
    revokeOutput(item);
    item.status = "queued";
    item.error = "";
    item.dimensions = "";
  }
  setProgress(0, state.items.length);
  announce("");
}
function removeItem(id) {
  if (busy()) return;
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const item = state.items[index];
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  revokeOutput(item);
  state.items.splice(index, 1);
  render();
  const next = state.items[Math.min(index, state.items.length - 1)];
  (next
    ? rows.get(next.id)?.node.querySelector('[data-action="remove"]')
    : els.browseButton
  )?.focus();
}
function clearQueue() {
  if (busy()) return;
  for (const item of state.items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    revokeOutput(item);
  }
  state.items = [];
  setProgress(0, 1);
  announce("");
  render();
}
function revokeOutput(item) {
  if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
  item.outputBlob = null;
  item.outputUrl = null;
  item.outputSize = 0;
  item.outputMime = "";
}
function render() {
  const done = state.items.filter((item) => item.status === "done");
  const queued = state.items.filter((item) => item.status === "queued").length;
  const failed = state.items.filter((item) => item.status === "error").length;
  const original = sum(state.items.map((item) => item.file.size));
  const processedOriginal = sum(done.map((item) => item.file.size));
  const output = sum(done.map((item) => item.outputSize));
  const saved = processedOriginal - output;
  document.body.classList.toggle("has-images", state.items.length > 0);
  els.metricCount.textContent = state.items.length;
  els.metricSize.textContent = formatBytes(original);
  $("metric-output").textContent = done.length ? formatBytes(output) : "—";
  $("savings-label").textContent =
    saved < 0
      ? "Larger"
      : done.length < state.items.length
        ? "Saved so far"
        : "Saved";
  els.metricSaved.textContent = done.length
    ? `${Math.abs(Math.round((saved / processedOriginal) * 100))}%`
    : "—";
  const queueStatus = getQueueStatus(done.length, queued, failed);
  if (els.queueStatus.textContent !== queueStatus)
    els.queueStatus.textContent = queueStatus;
  els.emptyState.hidden = state.items.length > 0;
  $("batch-summary").hidden = !state.items.length;
  $("queue-toolbar").hidden = !state.items.length;
  els.clearButton.hidden = !state.items.length;
  els.progress.hidden = !state.processing;
  els.processButton.disabled =
    busy() || (!queued && !failed) || !!settingsError();
  els.processButton.textContent = state.processing
    ? "Processing…"
    : failed && !queued
      ? "Retry failed images"
      : "Process batch";
  els.processButton.hidden = state.processing;
  const allReady = done.length > 0 && done.length === state.items.length;
  els.zipButton.classList.toggle("primary", allReady);
  els.zipButton.classList.toggle("secondary", !allReady);
  els.processButton.classList.toggle("primary", !allReady);
  els.processButton.classList.toggle("secondary", allReady);
  $("cancel-button").hidden = !state.processing;
  $("cancel-button").setAttribute("aria-disabled", String(state.cancel));
  const cancelLabel = state.cancel ? "Stopping…" : "Stop batch";
  if ($("cancel-button").textContent !== cancelLabel)
    $("cancel-button").textContent = cancelLabel;
  els.zipButton.disabled = busy() || !done.length;
  els.zipButton.querySelector("span").textContent = state.buildingZip
    ? "Preparing ZIP…"
    : "Download ZIP";
  els.clearButton.disabled = busy();
  els.browseButton.disabled = busy();
  els.fileInput.disabled = busy();
  $("sample-button").disabled = busy();
  $("settings-fields").disabled = busy();
  $("action-status").textContent = state.importing
    ? "Loading sample photos…"
    : state.buildingZip
      ? "Preparing ZIP…"
      : state.processing
        ? state.cancel
          ? "Finishing current image…"
          : `Processing ${state.items.findIndex((item) => item.status === "processing") + 1} of ${state.items.length}`
        : done.length
          ? `${done.length} ready to download${queued ? ` · ${queued} queued` : ""}`
          : state.items.length
            ? `${queued} queued${failed ? ` · ${failed} failed` : ""}`
            : "No images selected";
  updateSettings();
  const ids = new Set(state.items.map((item) => item.id));
  for (const [id, row] of rows)
    if (!ids.has(id)) {
      row.node.remove();
      rows.delete(id);
    }
  for (const item of state.items) {
    const html = renderItem(item);
    let row = rows.get(item.id);
    if (!row) {
      const node = document.createElement("article");
      node.className = "queue-item";
      row = { node, html: "" };
      rows.set(item.id, row);
      els.queueList.append(node);
    }
    if (row.html !== html) {
      row.node.innerHTML = html;
      row.html = html;
    }
  }
}
function renderItem(item) {
  const done = item.status === "done";
  const savings = item.file.size - item.outputSize;
  const preview =
    item.previewUrl && item.status !== "error"
      ? `<img src="${item.previewUrl}" alt="" loading="lazy" decoding="async">`
      : icon("images");
  const label = escapeHtml(item.file.name);
  return `<button class="thumb" data-action="preview" data-id="${item.id}" aria-label="Compare ${label}" title="Compare original and result" ${done && item.previewUrl && !busy() ? "" : "disabled"}>${preview}${done && item.previewUrl ? `<span class="preview-hint">${icon("eye")}</span>` : ""}</button>
  <div class="file-meta"><div class="file-name" title="${label}">${label}</div><div class="file-submeta">${formatBytes(item.file.size)}${done ? ` → <span class="file-result">${formatBytes(item.outputSize)}</span> · ${extensionForMime(item.outputMime).slice(1).toUpperCase()} · ${item.dimensions}` : ` · ${escapeHtml(getFileExtension(item.file.name))}`}</div>
  <span class="status ${item.status}">${icon(done ? "check" : item.status === "processing" ? "loader" : item.status === "error" ? "close" : "images")}${done ? `${Math.abs(Math.round((savings / item.file.size) * 100))}% ${savings < 0 ? "larger" : "smaller"}` : statusLabel(item.status)}</span>
  ${item.error ? `<p class="error-text">${escapeHtml(item.error)}</p>` : ""}${item.previewUnavailable ? '<p class="file-submeta">Comparison unavailable. Download is ready.</p>' : ""}</div>
  <div class="row-actions"><button class="icon-button" data-action="download" data-id="${item.id}" title="Download image" aria-label="Download ${label}" ${done && !busy() ? "" : "disabled"}>${icon("download")}</button><button class="icon-button" data-action="remove" data-id="${item.id}" title="Remove image" aria-label="Remove ${label}" ${busy() ? "disabled" : ""}>${icon("close")}</button></div>`;
}
function showPreview(item) {
  if (busy() || !item.outputUrl) return;
  state.previewId = item.id;
  $("preview-dialog").classList.remove("actual-size");
  document.querySelector('[name="preview-scale"][value="fit"]').checked = true;
  $("preview-title").textContent = item.file.name;
  for (const name of ["original", "result"]) {
    $(`preview-${name}-loading`).textContent = "Loading preview…";
    $(`preview-${name}-loading`).hidden = false;
    $(`preview-${name}`).parentElement.setAttribute("aria-busy", "true");
  }
  $("preview-original").src = item.previewUrl;
  $("preview-result").src = item.outputUrl;
  $("preview-original-size").textContent = formatBytes(item.file.size);
  $("preview-result-size").textContent = formatBytes(item.outputSize);
  $("preview-info").textContent =
    `${item.dimensions} · ${item.outputMime.replace("image/", "").toUpperCase()}${item.previewIsProxy ? " · HEIC original shown as a reduced preview" : ""}`;
  $("preview-dialog").showModal();
}
async function downloadZip() {
  if (busy()) return;
  const ready = state.items.filter(
    (item) => item.status === "done" && item.outputBlob,
  );
  if (!ready.length) return;
  state.buildingZip = true;
  render();
  try {
    const usedNames = new Map();
    const entries = ready.map((item) => ({
      name: getUniqueName(getOutputName(item, item.outputMime), usedNames),
      blob: item.outputBlob,
    }));
    const zip = await createZip(entries);
    downloadBlob(
      zip,
      `bulk-image-size-reducer-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    announce(
      `ZIP prepared with ${ready.length} image${ready.length === 1 ? "" : "s"}.`,
    );
  } catch {
    announce(
      "The ZIP could not be created. Download individual images or try a smaller batch.",
      true,
    );
  } finally {
    state.buildingZip = false;
    render();
  }
}

async function createZip(entries) {
  const parts = [];
  const centralDirectory = [];
  let offset = 0;
  const { date, time } = getDosDateTime(new Date());

  for (const entry of entries) {
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const name = encoder.encode(sanitizeZipPath(entry.name));
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeLocalHeader(localView, name, data.length, crc, time, date);
    localHeader.set(name, 30);
    parts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeCentralHeader(centralView, name, data.length, crc, time, date, offset);
    centralHeader.set(name, 46);
    centralDirectory.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const header of centralDirectory) {
    parts.push(header);
    centralSize += header.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);
  parts.push(end);

  return new Blob(parts, { type: "application/zip" });
}

function writeLocalHeader(view, name, size, crc, time, date) {
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
}

function writeCentralHeader(view, name, size, crc, time, date, offset) {
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function getOutputName(item, mime) {
  const suffix = els.suffix.value.trim();
  const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
  return sanitizeZipPath(`${base}${suffix}${extensionForMime(mime)}`);
}

function extensionForMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".img";
}

function isAcceptedImageFile(file) {
  return (
    /\.(jpe?g|png|webp|avif)$/i.test(file.name) ||
    ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
      file.type.toLowerCase(),
    ) ||
    isHeicFile(file)
  );
}

function isHeicFile(file) {
  return (
    heicMimeTypes.has(file.type.toLowerCase()) ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

function getFileTypeLabel(file) {
  if (file.type) return file.type;

  const extension = getFileExtension(file.name);
  return extension ? `image/${extension.toLowerCase()}` : "image";
}

function getFileExtension(name) {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toUpperCase() : "";
}

function sanitizeZipPath(name) {
  let normalized =
    name
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "_")
      .replace(/[. ]+$/, "") || "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized))
    normalized = `_${normalized}`;
  const dot = normalized.lastIndexOf(".");
  const extension = dot > 0 ? normalized.slice(dot) : "";
  const stem = dot > 0 ? normalized.slice(0, dot) : normalized;
  // Leave room for collision suffixes on filesystems with 255-byte name limits.
  const budget = 240 - encoder.encode(extension).length;
  let shortened = "",
    bytes = 0;
  for (const character of stem) {
    bytes += encoder.encode(character).length;
    if (bytes > budget) break;
    shortened += character;
  }
  return (shortened || "image") + extension;
}
function getUniqueName(name, usedNames) {
  const normalized = sanitizeZipPath(name);
  const extensionIndex = normalized.lastIndexOf(".");
  const base =
    extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized;
  const ext = extensionIndex > 0 ? normalized.slice(extensionIndex) : "";
  let result = normalized,
    count = 2;
  while (usedNames.has(result.toLowerCase()))
    result = `${base}-${count++}${ext}`;
  usedNames.set(result.toLowerCase(), true);
  return result;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function getQueueStatus(doneCount, queuedCount, errorCount) {
  if (state.items.length === 0) return "No images selected";
  if (state.processing) return "Processing batch";

  const parts = [];
  if (doneCount) parts.push(`${doneCount} done`);
  if (queuedCount) parts.push(`${queuedCount} queued`);
  if (errorCount) parts.push(`${errorCount} failed`);
  return parts.join(" - ");
}

function getSavings(originalBytes, outputBytes) {
  if (!originalBytes || !outputBytes) return "0%";
  const savings = Math.round((1 - outputBytes / originalBytes) * 100);
  return `${savings}%`;
}

function setProgress(value, max) {
  els.progress.max = Math.max(1, max);
  els.progress.value = Math.min(value, max);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function statusLabel(status) {
  return {
    queued: "Queued",
    processing: "Working",
    done: "Done",
    error: "Failed",
  }[status];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

render();
