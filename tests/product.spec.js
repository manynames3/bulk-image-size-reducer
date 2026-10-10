import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const sample = resolve("assets/samples/alpine-lake.jpg");
const heic = resolve("tests/fixtures/sample.heic");
const upload = (page, files) =>
  page.locator("#file-input").setInputFiles(files);
async function compress(page) {
  await page.locator("#process-button").click();
  await expect(page.locator("#cancel-button")).toBeHidden({ timeout: 60000 });
}
async function transparent(page) {
  return Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 40;
      c.getContext("2d").fillRect(40, 0, 40, 40);
      return [
        ...new Uint8Array(
          await (
            await new Promise((r) => c.toBlob(r, "image/png"))
          ).arrayBuffer(),
        ),
      ];
    }),
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("failed sample loading preserves the queue and restores importing", async ({
  page,
}) => {
  await upload(page, sample);
  await page.route("**/assets/samples/forest-light.jpg", (route) =>
    route.abort(),
  );
  await page.locator("#sample-button").click();
  await expect(page.locator("#notice")).toContainText("Choose your own images");
  await expect(page.locator("#browse-button")).toBeEnabled();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
});

test("empty state, real samples, results, comparison and downloads", async ({
  page,
}, info) => {
  await expect(page.locator("#process-button")).toBeDisabled();
  await expect(page.locator("#empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Try sample photos" }).click();
  await expect(page.locator(".queue-item")).toHaveCount(3);
  await expect(page.locator("#empty-state")).toBeHidden();
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(3);
  await expect(page.locator("#process-button")).toBeDisabled();
  await expect(page.locator("#metric-saved")).not.toHaveText("—");
  await page.getByRole("button", { name: "Compare alpine-lake.jpg" }).click();
  await expect(
    page.getByRole("dialog", { name: "alpine-lake.jpg" }),
  ).toBeVisible();
  expect(
    await page
      .locator("#preview-result")
      .evaluate((i) => i.complete && i.naturalWidth > 0),
  ).toBe(true);
  const single = page.waitForEvent("download");
  await page.locator("#preview-download").click();
  const extension = await page.evaluate(() =>
    defaultFormat === "webp" ? "webp" : "jpg",
  );
  expect((await single).suggestedFilename()).toBe(
    "alpine-lake-reduced." + extension,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview-dialog")).not.toBeVisible();
  const archive = page.waitForEvent("download");
  await page.locator("#zip-button").click();
  const download = await archive;
  const path = info.outputPath("batch.zip");
  await download.saveAs(path);
  const output = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
  expect(output).toContain("No errors detected");
  expect(
    execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
      .trim()
      .split("\n"),
  ).toHaveLength(3);
});

test("drop, duplicates, unsupported and empty files give feedback", async ({
  page,
}) => {
  const bytes = [...readFileSync(sample)];
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "drop.jpg", {
        type: "image/jpeg",
        lastModified: 1,
      }),
    );
    document
      .querySelector("#drop-zone")
      .dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: data }),
      );
  }, bytes);
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await upload(page, [
    { name: "drop.jpg", mimeType: "image/jpeg", buffer: Buffer.from(bytes) },
    { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("test") },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
  ]);
  await expect(page.locator("#notice")).toContainText("unsupported format");
  await expect(page.locator("#notice")).toContainText("empty");
  await upload(page, sample);
  await upload(page, sample);
  await expect(page.locator("#notice")).toContainText("duplicate");
});

test("corrupt image fails without losing successful outputs; retry and remove", async ({
  page,
}) => {
  await upload(page, [
    {
      name: "alpine-lake.jpg",
      mimeType: "image/jpeg",
      buffer: readFileSync(sample),
    },
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    },
  ]);
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator(".status.error")).toHaveCount(1);
  await expect(page.locator(".queue-item .error-text")).toContainText(
    "could not be read",
  );
  const outputBefore = await page.evaluate(() => state.items[0].outputUrl);
  await compress(page);
  expect(await page.evaluate(() => state.items[0].outputUrl)).toBe(
    outputBefore,
  );
  await page
    .getByRole("button", { name: "Remove broken.png", exact: true })
    .click();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expect(page.locator("#zip-button")).toBeEnabled();
});

test("JPEG white background, PNG transparency, dimensions and no upscaling", async ({
  page,
}) => {
  const bytes = await transparent(page);
  await upload(page, {
    name: "alpha.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await page.getByText("JPEG", { exact: true }).click();
  await page.locator("#max-width").fill("160");
  await compress(page);
  const pixels = await page.evaluate(async () => {
    const b = await createImageBitmap(state.items[0].outputBlob);
    const c = document.createElement("canvas");
    c.width = b.width;
    c.height = b.height;
    c.getContext("2d").drawImage(b, 0, 0);
    return {
      width: b.width,
      height: b.height,
      pixel: [...c.getContext("2d").getImageData(0, 0, 1, 1).data],
    };
  });
  expect(pixels).toEqual({
    width: 80,
    height: 40,
    pixel: [255, 255, 255, 255],
  });
  await page.getByText("PNG", { exact: true }).click();
  await expect(page.locator("#quality")).toBeDisabled();
  await page.locator("#no-upscale").uncheck();
  await page.locator("#max-height").fill("60");
  await compress(page);
  expect(
    await page.evaluate(async () => {
      const b = await createImageBitmap(state.items[0].outputBlob);
      const c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d").drawImage(b, 0, 0);
      return {
        width: b.width,
        height: b.height,
        alpha: c.getContext("2d").getImageData(0, 0, 1, 1).data[3],
      };
    }),
  ).toEqual({ width: 120, height: 60, alpha: 0 });
});

test("invalid dimensions and filename suffix cannot start a batch", async ({
  page,
}) => {
  await upload(page, sample);
  for (const value of ["0", "-20", "1.5", "9000"]) {
    await page.locator("#max-width").fill(value);
    await expect(page.locator("#process-button")).toBeDisabled();
    await expect(page.locator("#settings-error")).toBeVisible();
  }
  await page.locator("#max-width").fill("");
  await page.locator("#filename-suffix").fill("../output");
  await expect(page.locator("#process-button")).toBeDisabled();
  await page.locator("#filename-suffix").fill("-small");
  await expect(page.locator("#process-button")).toBeEnabled();
});

test("settings and removals are locked during work; stop and resume is consistent", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try sample photos" }).click();
  // Hold real decoding at its async boundary to exercise actions while a file is in flight.
  await page.evaluate(() => {
    window.queueAnnouncements = [];
    new MutationObserver(() =>
      window.queueAnnouncements.push(
        document.querySelector("#queue-status").textContent,
      ),
    ).observe(document.querySelector("#queue-status"), { childList: true });
    const decode = decodeImage;
    window.releaseDecode = null;
    decodeImage = async (file) => {
      if (!window.releaseDecode)
        await new Promise((r) => (window.releaseDecode = r));
      return decode(file);
    };
  });
  await page.locator("#process-button").click();
  await expect(page.locator("#cancel-button")).toBeFocused();
  await expect(page.locator("#max-width")).toBeDisabled();
  await expect(page.locator("#clear-button")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove alpine-lake.jpg", exact: true }),
  ).toBeDisabled();
  await page.locator("#cancel-button").click();
  await expect(page.locator("#cancel-button")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.locator("#cancel-button")).toBeFocused();
  await page.evaluate(() => window.releaseDecode());
  await expect(page.locator("#cancel-button")).toBeHidden();
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator(".status.queued")).toHaveCount(2);
  await expect(page.locator("#process-button")).toBeFocused();
  const saved = await page.evaluate(() =>
    Math.round(
      (1 - state.items[0].outputSize / state.items[0].file.size) * 100,
    ),
  );
  await expect(page.locator("#metric-saved")).toHaveText(Math.abs(saved) + "%");
  await expect(page.locator("#savings-label")).toHaveText(
    saved < 0 ? "Larger" : "Saved so far",
  );
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(3);
  await expect(page.locator("#zip-button")).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        window.queueAnnouncements.filter(
          (message) => message === "Processing batch",
        ).length,
    ),
  ).toBe(2);
});

test("HEIC with empty MIME converts and releases its worker", async ({
  page,
}) => {
  await upload(page, {
    name: "iphone.HEIC",
    mimeType: "",
    buffer: readFileSync(heic),
  });
  await page.getByText("Same", { exact: true }).click();
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  expect(await page.evaluate(() => state.items[0].outputMime)).toBe(
    await page.evaluate(() => (supportsWebP ? "image/webp" : "image/png")),
  );
  expect(await page.evaluate(() => typeof window.__heic2any__worker)).toBe(
    "undefined",
  );
  await page.getByRole("button", { name: "Compare iphone.HEIC" }).click();
  await expect(page.locator("#preview-original")).toBeVisible();
});

test("same-format blank MIME works; ZIP avoids natural suffix and case collisions", async ({
  page,
}, info) => {
  const bytes = await transparent(page);
  await upload(
    page,
    ["photo.png", "photo.webp", "photo-reduced-2.png", "PHOTO.PNG"].map(
      (name) => ({ name, mimeType: "", buffer: bytes }),
    ),
  );
  await page.getByText("Same", { exact: true }).click();
  await compress(page);
  expect(await page.evaluate(() => state.items[0].outputMime)).toBe(
    "image/png",
  );
  // All same basenames map to PNG and force actual ZIP filename conflicts.
  await page.getByText("PNG", { exact: true }).click();
  await compress(page);
  const promise = page.waitForEvent("download");
  await page.locator("#zip-button").click();
  const path = info.outputPath("collisions.zip");
  await (await promise).saveAs(path);
  const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .trim()
    .split("\n");
  expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
});

test("clear confirmation, keyboard dismissal and focus recovery", async ({
  page,
}) => {
  await upload(page, sample);
  await compress(page);
  await page.locator("#clear-button").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await page.locator("#clear-button").click();
  await page.locator("#confirm-clear").click();
  await expect(page.locator(".queue-item")).toHaveCount(0);
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#browse-button")).toBeFocused();
  await expect(page.locator("#zip-button")).toBeDisabled();
});

test("desktop and mobile accessibility and horizontal fit", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Bulk Image Size Reducer",
  );
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(page.locator("#process-button")).toHaveText("Process batch");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 640 : 900 });
    await expect(page.locator("#settings-fields")).toBeVisible();
    await expect(page.locator("#quality")).toBeVisible();
    await expect(page.locator("#preset")).toBeVisible();
    if (width > 680) {
      const settings = await page.locator(".settings-panel").boundingBox();
      const images = await page.locator(".image-import").boundingBox();
      expect(settings.x + settings.width).toBeLessThan(images.x);
    }
    await expect
      .poll(() =>
        page.locator("#browse-button").evaluate((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            button.contains(
              document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.bottom - 1,
              ),
            )
          );
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Try sample photos" }).click();
  await compress(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Compare alpine-lake.jpg" }).click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("larger outputs are labelled honestly; preset changes invalidate old results", async ({
  page,
}) => {
  await upload(page, sample);
  await page.getByText("PNG", { exact: true }).click();
  await compress(page);
  await expect(page.locator("#savings-label")).toHaveText("Larger");
  await expect(page.locator(".status.done")).toContainText("larger");
  await page.locator("#preset").selectOption("small");
  await expect(page.locator("#zip-button")).toBeDisabled();
  await expect(page.locator("#max-width")).toHaveValue("1280");
  await expect(page.locator("#quality")).toHaveValue(
    await page.evaluate(() => (supportsWebP ? "65" : "50")),
  );
  await compress(page);
  await expect(page.locator(".file-submeta")).toContainText("1280");
});

test("full-resolution comparison keeps images at natural size and resets on reopen", async ({
  page,
}) => {
  await upload(page, sample);
  await compress(page);
  await page.getByRole("button", { name: "Compare alpine-lake.jpg" }).click();
  await page.getByText("100%", { exact: true }).click();
  expect(
    await page
      .locator("#preview-result")
      .evaluate((i) => i.getBoundingClientRect().width === i.naturalWidth),
  ).toBe(true);
  expect(
    await page
      .locator(".preview-image")
      .last()
      .evaluate((p) => p.scrollWidth > p.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Compare alpine-lake.jpg" }).click();
  await expect(
    page.locator('[name="preview-scale"][value="fit"]'),
  ).toBeChecked();
});

test("ZIP failure preserves results and allows a successful retry", async ({
  page,
}, info) => {
  await upload(page, sample);
  await compress(page);
  await page.evaluate(() => {
    window.realZip = createZip;
    createZip = async () => {
      throw Error("simulated allocation failure");
    };
  });
  await page.locator("#zip-button").click();
  await expect(page.locator("#notice")).toContainText(
    "Download individual images",
  );
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator("#zip-button")).toBeEnabled();
  await page.evaluate(() => {
    createZip = window.realZip;
  });
  const promise = page.waitForEvent("download");
  await page.locator("#zip-button").click();
  const path = info.outputPath("retry.zip");
  await (await promise).saveAs(path);
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain(
    "No errors detected",
  );
});

test("HEIC network failures recover and downstream errors keep their actual cause", async ({
  page,
}) => {
  // Force the converter branch even on browsers with native HEIC decoding.
  await page.evaluate(() => {
    decodeImage = (file) => decodeHeicImage(file);
  });
  await page.route("**/vendor/heic2any/**", (route) => route.abort());
  await upload(page, {
    name: "iphone.heic",
    mimeType: "image/heic",
    buffer: readFileSync(heic),
  });
  await compress(page);
  await expect(page.locator(".queue-item .error-text")).toContainText(
    "converter could not load",
  );
  await expect(page.locator("#max-width")).toBeEnabled();
  await page.unroute("**/vendor/heic2any/**");
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  await page.locator("#max-width").fill("800");
  await page.evaluate(() => {
    const decode = decodeImage;
    decodeImage = async (f) => {
      const image = await decode(f);
      image.width = 40_000;
      image.height = 40_000;
      return image;
    };
  });
  await compress(page);
  await expect(page.locator(".queue-item .error-text")).toContainText(
    "exceeds 64 megapixels",
  );
  expect(await page.evaluate(() => state.items[0].outputBlob)).toBeNull();
});

test("optional HEIC preview failure does not lose a successful export", async ({
  page,
}) => {
  await upload(page, {
    name: "iphone.heic",
    mimeType: "image/heic",
    buffer: readFileSync(heic),
  });
  await page.evaluate(() => {
    const convert = canvasToBlob;
    let calls = 0;
    canvasToBlob = (...args) =>
      ++calls === 2
        ? Promise.reject(Error("preview allocation failed"))
        : convert(...args);
  });
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator(".file-submeta").last()).toContainText(
    "Comparison unavailable",
  );
  await expect(page.locator("#zip-button")).toBeEnabled();
});

test("input and output limits reject safely without allocating oversized fixtures", async ({
  page,
}) => {
  await page.evaluate(() => {
    const f = new File(["x"], "large.jpg", { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: MAX_FILE + 1 });
    addFiles([f]);
  });
  await expect(page.locator("#notice")).toContainText("50 MB per image");
  await expect(page.locator(".queue-item")).toHaveCount(0);
  await upload(page, sample);
  // Only metadata is inflated, avoiding a half-gigabyte test allocation.
  await page.evaluate(() => {
    const convert = canvasToBlob;
    canvasToBlob = async (...args) => {
      const b = await convert(...args);
      Object.defineProperty(b, "size", { value: MAX_BATCH + 1 });
      return b;
    };
  });
  await compress(page);
  await expect(page.locator(".queue-item .error-text")).toContainText(
    "500 MB batch limit",
  );
  await expect(page.locator("#zip-button")).toBeDisabled();
});

test("100-image batch processes real files, stays interactive and makes no upload requests", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const requests = [];
  page.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  const bytes = readFileSync(sample);
  await upload(
    page,
    Array.from({ length: 100 }, (_, n) => ({
      name: `photo-${n}.jpg`,
      mimeType: "image/jpeg",
      buffer: bytes,
    })),
  );
  await page.locator("#max-width").fill("800");
  await page.evaluate(() => {
    window.pulses = 0;
    window.pulseTimer = setInterval(() => window.pulses++, 50);
  });
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(100);
  expect(
    await page.evaluate(() => {
      clearInterval(window.pulseTimer);
      return window.pulses;
    }),
  ).toBeGreaterThan(2);
  expect(
    requests.filter(
      (r) =>
        r.method !== "GET" || new URL(r.url).origin !== "http://127.0.0.1:4184",
    ),
  ).toEqual([]);
  const promise = page.waitForEvent("download");
  await page.locator("#zip-button").click();
  const path = info.outputPath("hundred-images.zip");
  await (await promise).saveAs(path);
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain(
    "No errors detected",
  );
  expect(
    execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
      .trim()
      .split("\n"),
  ).toHaveLength(100);
});
