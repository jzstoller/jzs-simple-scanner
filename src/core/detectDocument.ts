/**
 * Draws the detected quadrilateral on the original image and saves a debug overlay PNG.
 * @param imagePath Path to the original image
 * @param corners Array of 4 points (tl, tr, br, bl)
 * @param outputPath Where to save the overlay PNG
 */
export async function saveDebugOverlay(
  imagePath: string,
  corners: [Corner, Corner, Corner, Corner],
  outputPath: string
) {
  // Load original image as RGBA
  const image = sharp(imagePath).ensureAlpha();
  const meta = await image.metadata();
  const w = meta.width!;
  const h = meta.height!;

  // Draw the quadrilateral as an SVG overlay
  const points = corners.concat([corners[0]]) // close the loop
    .map(pt => `${pt.x},${pt.y}`)
    .join(' ');
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${points}" fill="none" stroke="#ff2a2a" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="${corners[0].x}" cy="${corners[0].y}" r="16" fill="#ff2a2a"/>
    <circle cx="${corners[1].x}" cy="${corners[1].y}" r="16" fill="#2a7fff"/>
    <circle cx="${corners[2].x}" cy="${corners[2].y}" r="16" fill="#2aff2a"/>
    <circle cx="${corners[3].x}" cy="${corners[3].y}" r="16" fill="#ffea2a"/>
  </svg>`;

  await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);
}
import cv from "@techstark/opencv-js";
import sharp from "sharp";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Corner {
  x: number;
  y: number;
}

export interface DetectResult {
  /** Corners ordered clockwise from top-left: tl, tr, br, bl */
  corners: [Corner, Corner, Corner, Corner];
  /** Grayscale warped Mat – call .delete() when done to avoid WASM memory leaks */
  warped: ReturnType<typeof cv.matFromArray>;
  width: number;
  height: number;
}

// ── OpenCV init ────────────────────────────────────────────────────────────────

/** Wait for the OpenCV WASM runtime to finish loading before calling any cv.* functions. */
function loadCV(): Promise<void> {
  return new Promise((resolve) => {
    if (cv.Mat !== undefined) {
      resolve();
    } else {
      cv.onRuntimeInitialized = resolve;
    }
  });
}

// ── Core function ──────────────────────────────────────────────────────────────

/** Max dimension used for edge detection. Keeps processing fast and suppresses fine texture. */
const DETECT_SIZE = 1000;

export async function detectDocument(imagePath: string): Promise<DetectResult> {
  await loadCV();

  // 1. Get original dimensions so we can scale corners back later
  const meta = await sharp(imagePath).metadata();
  const origW = meta.width!;
  const origH = meta.height!;

  // 2. Downscale for detection – suppresses internal text/texture noise,
  //    makes the document boundary the dominant contour
  const scale = Math.min(1, DETECT_SIZE / Math.max(origW, origH));
  const detW = Math.round(origW * scale);
  const detH = Math.round(origH * scale);

  const { data, info } = await sharp(imagePath)
    .resize(detW, detH)
    .greyscale()
    .blur(3)  // stronger blur to suppress internal detail
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1);
  mat.data.set(data);

  // 3. Canny edges
  const edges = new cv.Mat();
  cv.Canny(mat, edges, 50, 150);
  mat.delete();

  // 4. Dilate to close gaps in the document boundary
  const kernel = cv.Mat.ones(3, 3, cv.CV_8UC1);
  const dilated = new cv.Mat();
  cv.dilate(edges, dilated, kernel);
  kernel.delete();
  edges.delete();

  // 5. RETR_EXTERNAL: only outer contours – ignores QR codes, barcodes, text boxes
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  dilated.delete();
  hierarchy.delete();

  // 6. Find the largest 4-point contour above a minimum area threshold
  const minArea = detW * detH * 0.1; // document must cover ≥ 10% of the detection frame
  let best: ReturnType<typeof cv.matFromArray> | null = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    if (area >= minArea) {
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

      if (approx.rows === 4 && area > bestArea) {
        bestArea = area;
        best?.delete();
        best = approx.clone();
      }
      approx.delete();
    }
    cnt.delete();
  }
  contours.delete();

  if (!best) {
    throw new Error(
      "No document contour found. Ensure the document has clear edges against the background."
    );
  }

  // 7. Scale corners back to original resolution
  const pts: Corner[] = Array.from({ length: 4 }, (_, i) => ({
    x: Math.round(best!.data32S[i * 2] / scale),
    y: Math.round(best!.data32S[i * 2 + 1] / scale),
  }));
  best.delete();

  const ordered = orderPoints(pts) as [Corner, Corner, Corner, Corner];

  // 8. Warp at full original resolution for maximum output quality
  const { data: origData, info: origInfo } = await sharp(imagePath)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const origMat = new cv.Mat(origInfo.height, origInfo.width, cv.CV_8UC1);
  origMat.data.set(origData);

  const { M, w, h } = buildTransform(ordered);
  const dst = new cv.Mat();
  cv.warpPerspective(origMat, dst, M, new cv.Size(Math.round(w), Math.round(h)));
  M.delete();
  origMat.delete();

  return {
    corners: ordered,
    warped: dst,
    width: Math.round(w),
    height: Math.round(h),
  };
}

/** Write a grayscale warped Mat to disk as PNG via Sharp. */
export async function saveWarped(
  warped: ReturnType<typeof cv.matFromArray>,
  width: number,
  height: number,
  outputPath: string
): Promise<void> {
  await sharp(Buffer.from(warped.data), {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toFile(outputPath);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Order 4 points clockwise starting from top-left: tl, tr, br, bl.
 *
 * Strategy:
 *   - tl = smallest  x+y  (closest to origin)
 *   - br = largest   x+y
 *   - Of the remaining two: smaller x → bl, larger x → tr
 *
 * Bug in original code: `[tr, bl]` was swapped — fixed here to `[bl, tr]`.
 */
function orderPoints(pts: Corner[]): Corner[] {
  const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[3];
  const [bl, tr] = sorted.slice(1, 3).sort((a, b) => a.x - b.x);
  return [tl, tr, br, bl];
}

function buildTransform(pts: Corner[]) {
  const [tl, tr, br, bl] = pts;

  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));

  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y,
  ]);
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,     0,
    w - 1, 0,
    w - 1, h - 1,
    0,     h - 1,
  ]);

  const M = cv.getPerspectiveTransform(src, dst);
  src.delete();
  dst.delete();
  return { M, w, h };
}

function dist(a: Corner, b: Corner): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
