const state = {
  items: [],
  processing: false,
};

const els = {
  dropZone: document.querySelector("#drop-zone"),
  fileInput: document.querySelector("#file-input"),
  browseButton: document.querySelector("#browse-button"),
  settingsForm: document.querySelector("#settings-form"),
  quality: document.querySelector("#quality"),
  qualityOutput: document.querySelector("#quality-output"),
  maxWidth: document.querySelector("#max-width"),
  maxHeight: document.querySelector("#max-height"),
  suffix: document.querySelector("#filename-suffix"),
  noUpscale: document.querySelector("#no-upscale"),
  processButton: document.querySelector("#process-button"),
  zipButton: document.querySelector("#zip-button"),
  clearButton: document.querySelector("#clear-button"),
  queueList: document.querySelector("#queue-list"),
  emptyState: document.querySelector("#empty-state"),
  queueStatus: document.querySelector("#queue-status"),
  progress: document.querySelector("#batch-progress"),
  metricCount: document.querySelector("#metric-count"),
  metricSize: document.querySelector("#metric-size"),
  metricSaved: document.querySelector("#metric-saved"),
};

const encoder = new TextEncoder();
const crcTable = buildCrcTable();
const heicMimeTypes = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

els.browseButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  addFiles(els.fileInput.files);
  els.fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragover");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

els.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    els.fileInput.click();
  }
});

els.quality.addEventListener("input", () => {
  els.qualityOutput.value = els.quality.value;
  markQueued();
});

els.maxWidth.addEventListener("input", markQueued);
els.maxHeight.addEventListener("input", markQueued);
els.noUpscale.addEventListener("change", markQueued);
els.settingsForm.addEventListener("change", (event) => {
  if (event.target.name === "format") {
    markQueued();
  }
});

els.suffix.addEventListener("input", render);
els.processButton.addEventListener("click", processAll);
els.zipButton.addEventListener("click", downloadZip);
els.clearButton.addEventListener("click", clearQueue);

els.queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = state.items.find((entry) => entry.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === "remove") {
    removeItem(item.id);
  }

  if (button.dataset.action === "download" && item.outputBlob) {
    downloadBlob(item.outputBlob, getOutputName(item, item.outputMime));
  }
});

function addFiles(fileList) {
  const files = Array.from(fileList).filter(isAcceptedImageFile);
  const existingKeys = new Set(state.items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));

  for (const file of files) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (existingKeys.has(key)) continue;

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
    existingKeys.add(key);
  }

  render();
}

async function processAll() {
  if (state.processing || state.items.length === 0) return;

  state.processing = true;
  setProgress(0, state.items.length);
  render();

  let completed = 0;
  for (const item of state.items) {
    await processItem(item);
    completed += 1;
    setProgress(completed, state.items.length);
    render();
  }

  state.processing = false;
  render();
}

async function processItem(item) {
  revokeOutput(item);
  item.status = "processing";
  item.error = "";
  render();

  let source = null;
  try {
    source = await decodeImage(item.file);
    const target = getTargetSize(source.width, source.height);
    const requestedMime = getRequestedMime(item.file);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext("2d", { alpha: requestedMime !== "image/jpeg" });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    if (requestedMime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(source.image, 0, 0, target.width, target.height);

    const blob = await canvasToBlob(canvas, requestedMime, getQuality(requestedMime));
    item.outputMime = blob.type || requestedMime;
    item.outputBlob = blob;
    item.outputSize = blob.size;
    item.outputUrl = URL.createObjectURL(blob);
    item.dimensions = `${target.width} x ${target.height}`;
    item.status = "done";
  } catch (error) {
    item.status = "error";
    item.error = error.message || "Unable to process this image.";
  } finally {
    if (source?.close) source.close();
  }
}

async function decodeImage(file) {
  if (isHeicFile(file)) {
    return decodeHeicImage(file);
  }

  return decodeRasterImage(file);
}

async function decodeHeicImage(file) {
  if (typeof window.heic2any !== "function") {
    throw new Error("HEIC support did not load. Refresh the page and try again.");
  }

  const converted = await window.heic2any({ blob: file, toType: "image/png" });
  const blob = Array.isArray(converted) ? converted[0] : converted;

  if (!(blob instanceof Blob)) {
    throw new Error("The browser could not convert this HEIC image.");
  }

  return decodeRasterImage(blob);
}

function decodeRasterImage(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bitmap) => ({
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }))
      .catch(() => decodeImageElement(file));
  }

  return decodeImageElement(file);
}

function decodeImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => {},
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The browser could not decode this image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`The browser could not export ${mime.replace("image/", "").toUpperCase()}.`));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

function getRequestedMime(file) {
  const selected = new FormData(els.settingsForm).get("format");
  if (selected === "same") {
    if (isHeicFile(file)) {
      return "image/webp";
    }
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return file.type;
    }
    return "image/webp";
  }
  return `image/${selected}`;
}

function getQuality(mime) {
  if (mime !== "image/jpeg" && mime !== "image/webp") return undefined;
  return Number(els.quality.value) / 100;
}

function getTargetSize(width, height) {
  const maxWidth = Number(els.maxWidth.value);
  const maxHeight = Number(els.maxHeight.value);
  const widthScale = maxWidth > 0 ? maxWidth / width : Infinity;
  const heightScale = maxHeight > 0 ? maxHeight / height : Infinity;
  let scale = Math.min(widthScale, heightScale);

  if (!Number.isFinite(scale)) scale = 1;
  if (els.noUpscale.checked) scale = Math.min(scale, 1);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function markQueued() {
  for (const item of state.items) {
    if (item.status === "processing") continue;
    revokeOutput(item);
    item.status = "queued";
    item.error = "";
    item.outputSize = 0;
    item.outputMime = "";
    item.dimensions = "";
  }
  render();
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index === -1) return;

  if (state.items[index].previewUrl) {
    URL.revokeObjectURL(state.items[index].previewUrl);
  }
  revokeOutput(state.items[index]);
  state.items.splice(index, 1);
  render();
}

function clearQueue() {
  for (const item of state.items) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
    revokeOutput(item);
  }
  state.items = [];
  setProgress(0, 1);
  render();
}

function revokeOutput(item) {
  if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
  item.outputBlob = null;
  item.outputUrl = null;
}

function render() {
  const doneItems = state.items.filter((item) => item.status === "done");
  const originalBytes = sum(state.items.map((item) => item.file.size));
  const outputBytes = sum(doneItems.map((item) => item.outputSize));
  const queuedCount = state.items.filter((item) => item.status === "queued").length;
  const errorCount = state.items.filter((item) => item.status === "error").length;

  els.metricCount.textContent = `${state.items.length} ${state.items.length === 1 ? "image" : "images"}`;
  els.metricSize.textContent = `${formatBytes(originalBytes)} queued`;
  els.metricSaved.textContent = `${getSavings(originalBytes, outputBytes)} saved`;

  els.queueStatus.textContent = getQueueStatus(doneItems.length, queuedCount, errorCount);
  els.emptyState.hidden = state.items.length > 0;
  els.queueList.innerHTML = state.items.map(renderItem).join("");

  els.processButton.disabled = state.processing || state.items.length === 0;
  els.zipButton.disabled = state.processing || doneItems.length === 0;
  els.clearButton.disabled = state.processing || state.items.length === 0;
}

function renderItem(item) {
  const statusClass = item.status;
  const outputText = item.status === "done"
    ? `${formatBytes(item.outputSize)} - ${item.dimensions} - ${getSavings(item.file.size, item.outputSize)} saved`
    : formatBytes(item.file.size);
  const errorText = item.error ? `<div class="error-text">${escapeHtml(item.error)}</div>` : "";
  const preview = item.previewUrl
    ? `<img src="${item.previewUrl}" alt="">`
    : `<div class="thumb-label">${escapeHtml(getFileExtension(item.file.name) || "IMG")}</div>`;

  return `
    <article class="queue-item">
      <div class="thumb">
        ${preview}
      </div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
        <div class="file-submeta">${escapeHtml(getFileTypeLabel(item.file))} - ${outputText}</div>
        ${errorText}
      </div>
      <div>
        <span class="status ${statusClass}">${statusLabel(item.status)}</span>
      </div>
      <div class="row-actions">
        <button class="icon-button" type="button" data-action="download" data-id="${item.id}" ${item.outputBlob ? "" : "disabled"} title="Download image" aria-label="Download ${escapeHtml(item.file.name)}">DL</button>
        <button class="icon-button" type="button" data-action="remove" data-id="${item.id}" title="Remove image" aria-label="Remove ${escapeHtml(item.file.name)}">x</button>
      </div>
    </article>
  `;
}

async function downloadZip() {
  const ready = state.items.filter((item) => item.outputBlob);
  if (ready.length === 0) return;

  els.zipButton.disabled = true;
  els.zipButton.textContent = "Building ZIP";

  try {
    const usedNames = new Map();
    const entries = ready.map((item) => {
      const name = getUniqueName(getOutputName(item, item.outputMime), usedNames);
      return { name, blob: item.outputBlob };
    });
    const zip = await createZip(entries);
    const suffix = new Date().toISOString().slice(0, 10);
    downloadBlob(zip, `bulk-image-size-reducer-${suffix}.zip`);
  } finally {
    els.zipButton.textContent = "Download ZIP";
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
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function getOutputName(item, mime) {
  const suffix = els.suffix.value.trim();
  const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
  return `${base}${suffix}${extensionForMime(mime)}`;
}

function extensionForMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".img";
}

function isAcceptedImageFile(file) {
  return file.type.startsWith("image/") || isHeicFile(file);
}

function isHeicFile(file) {
  return heicMimeTypes.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
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
  return name
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, "_"))
    .join("/");
}

function getUniqueName(name, usedNames) {
  const normalized = sanitizeZipPath(name);
  const seen = usedNames.get(normalized) || 0;
  usedNames.set(normalized, seen + 1);

  if (seen === 0) return normalized;

  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) return `${normalized}-${seen + 1}`;

  return `${normalized.slice(0, extensionIndex)}-${seen + 1}${normalized.slice(extensionIndex)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
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
