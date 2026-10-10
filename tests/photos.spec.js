import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upload = (page, files) =>
  page.locator("#file-input").setInputFiles(files);
async function compress(page) {
  await page.locator("#process-button").click();
  await expect(page.locator("#cancel-button")).toBeHidden({ timeout: 60000 });
}

function orientedJpeg(jpeg, orientation) {
  // Minimal EXIF fixture: little-endian TIFF with one SHORT Orientation entry.
  const exif = Buffer.from([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0,
    0x49,
    0x49,
    0x2a,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

for (const format of ["avif", "webp"]) {
  test(`real ${format.toUpperCase()} input with an empty MIME type decodes and exports`, async ({
    page,
  }) => {
    const bytes = readFileSync(`tests/fixtures/sample.${format}`);
    await upload(page, {
      name: `photo.${format}`,
      mimeType: "",
      buffer: bytes,
    });
    await page.getByText("Same", { exact: true }).click();
    await compress(page);
    await expect(page.locator(".status.done")).toHaveCount(1);
    expect(await page.evaluate(() => state.items[0].outputMime)).toBe(
      await page.evaluate(() => (supportsWebP ? "image/webp" : "image/png")),
    );
    const result = await page.evaluate(async () => {
      const bitmap = await createImageBitmap(state.items[0].outputBlob);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0, 16, 16);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        values: new Set(context.getImageData(0, 0, 16, 16).data).size,
      };
      bitmap.close();
      return result;
    });
    expect(result.width).toBe(320);
    expect(result.height).toBeGreaterThan(100);
    expect(result.values).toBeGreaterThan(50);
  });
}

test("all eight EXIF orientations preserve corner colors and dimensions", async ({
  page,
}) => {
  const jpeg = Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 40;
      const x = c.getContext("2d");
      for (const [color, left, top] of [
        ["#ff0000", 0, 0],
        ["#00ff00", 40, 0],
        ["#0000ff", 0, 20],
        ["#ffff00", 40, 20],
      ]) {
        x.fillStyle = color;
        x.fillRect(left, top, 40, 20);
      }
      return [
        ...new Uint8Array(
          await (
            await new Promise((r) => c.toBlob(r, "image/jpeg", 1))
          ).arrayBuffer(),
        ),
      ];
    }),
  );
  await upload(
    page,
    Array.from({ length: 8 }, (_, i) => ({
      name: `orientation-${i + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer: orientedJpeg(jpeg, i + 1),
    })),
  );
  await page.getByText("PNG", { exact: true }).click();
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(8);
  const pixels = await page.evaluate(async () =>
    Promise.all(
      state.items.map(async (item) => {
        const b = await createImageBitmap(item.outputBlob);
        const c = document.createElement("canvas");
        c.width = b.width;
        c.height = b.height;
        const x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        const corners = [
          [5, 5],
          [b.width - 6, 5],
          [5, b.height - 6],
          [b.width - 6, b.height - 6],
        ].map(([left, top]) => {
          const [r, g, blue] = x.getImageData(left, top, 1, 1).data;
          return r > 200 && g > 200
            ? "Y"
            : r > 200
              ? "R"
              : g > 200
                ? "G"
                : blue > 200
                  ? "B"
                  : "?";
        });
        const result = {
          width: b.width,
          height: b.height,
          corners: corners.join(""),
        };
        b.close();
        c.width = c.height = 0;
        return result;
      }),
    ),
  );
  const corners = [
    "RGBY",
    "GRYB",
    "YBGR",
    "BYRG",
    "RBGY",
    "BRYG",
    "YGBR",
    "GYRB",
  ];
  expect(pixels).toEqual(
    corners.map((corners, i) => ({
      width: i < 4 ? 80 : 40,
      height: i < 4 ? 40 : 80,
      corners,
    })),
  );
});

test("48-megapixel photos can be reduced, but oversized outputs are rejected", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8000;
    c.height = 6000;
    const x = c.getContext("2d");
    x.fillStyle = "#4b89aa";
    x.fillRect(0, 0, 8000, 6000);
    x.fillStyle = "#6da96f";
    x.fillRect(0, 3000, 8000, 3000);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    c.width = c.height = 0;
    addFiles([new File([blob], "48-megapixel.jpg", { type: "image/jpeg" })]);
  });
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator(".file-submeta")).toContainText("1920 × 1440");
  await page.locator("#max-width").fill("");
  await compress(page);
  await expect(page.locator(".queue-item .error-text")).toContainText(
    "Output is too large",
  );
  await page.locator("#max-width").fill("1280");
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(1);
  await expect(page.locator(".file-submeta")).toContainText("1280 × 960");
});

test("ZIP filenames are portable, Unicode-safe and treated as text", async ({
  page,
}, info) => {
  const bytes = Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 40;
      c.getContext("2d").fillRect(0, 0, 80, 40);
      return [
        ...new Uint8Array(
          await (
            await new Promise((r) => c.toBlob(r, "image/png"))
          ).arrayBuffer(),
        ),
      ];
    }),
  );
  const names = [
    "CON.png",
    "NUL.webp",
    "caf\u00e9.png",
    "cafe\u0301.png",
    "very-long-".repeat(30) + ".png",
    "<img src=x onerror=alert(1)>.png",
  ];
  await upload(
    page,
    names.map((name) => ({ name, mimeType: "image/png", buffer: bytes })),
  );
  await page.locator("#filename-suffix").fill("");
  await page.getByText("PNG", { exact: true }).click();
  await compress(page);
  await expect(page.locator(".status.done")).toHaveCount(names.length);
  await expect(page.locator(".file-name img")).toHaveCount(0);
  const promise = page.waitForEvent("download");
  await page.locator("#zip-button").click();
  const path = info.outputPath("portable.zip");
  await (await promise).saveAs(path);
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain(
    "No errors detected",
  );
  const outputs = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .trim()
    .split("\n");
  expect(outputs).toContain("_CON.png");
  expect(outputs).toContain("_NUL.png");
  expect(
    new Set(outputs.map((n) => n.normalize("NFC").toLowerCase())).size,
  ).toBe(names.length);
  for (const name of outputs) {
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  }
});
