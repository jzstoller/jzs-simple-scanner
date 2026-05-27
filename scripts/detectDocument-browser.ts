// detectDocument-browser.ts
// OpenCV.js (WebAssembly) document detection for browser/Obsidian plugin

export interface Corner {
  x: number;
  y: number;
}

export interface DetectResult {
  corners: [Corner, Corner, Corner, Corner];
  warped: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Detects a document in an image using OpenCV.js (browser).
 * Scales down for detection, warps the original color image.
 * Falls back to the full image if no document contour is found.
 * @param imageSource HTMLImageElement or HTMLCanvasElement
 */
export function detectDocument(imageSource: HTMLImageElement | HTMLCanvasElement): DetectResult {
  const src = cv.imread(imageSource);

  // Scale down to max 1500px for reliable, fast detection on high-res phone photos
  const MAX_DIM = 1500;
  const scaleFactor = Math.min(MAX_DIM / src.cols, MAX_DIM / src.rows, 1.0);
  let small = new cv.Mat();
  if (scaleFactor < 1.0) {
    cv.resize(src, small, new cv.Size(Math.round(src.cols * scaleFactor), Math.round(src.rows * scaleFactor)));
  } else {
    src.copyTo(small);
  }

  // Grayscale → Blur → Canny → Dilate
  let gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY, 0);
  let blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  let edges = new cv.Mat();
  cv.Canny(blurred, edges, 75, 200);
  let dilated = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, dilated, kernel);

  // Find contours
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Find the largest valid 4-point contour (must be >10% of image area)
  const minArea = small.cols * small.rows * 0.1;
  let maxArea = minArea;
  let bestContour: any = null;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
    const area = cv.contourArea(approx);
    if (approx.rows === 4 && area > maxArea) {
      const pts = ptsFromMat(approx);
      if (isValidQuad(pts)) {
        maxArea = area;
        if (bestContour) bestContour.delete();
        bestContour = approx.clone();
      }
    }
    approx.delete();
    cnt.delete();
  }

  // Cleanup detection intermediates
  small.delete(); gray.delete(); blurred.delete();
  edges.delete(); dilated.delete(); kernel.delete();
  contours.delete(); hierarchy.delete();

  let warpedCanvas: HTMLCanvasElement;
  let corners: [Corner, Corner, Corner, Corner];

  if (bestContour) {
    const rawPts = ptsFromMat(bestContour);
    bestContour.delete();
    // Scale corners back to original full-resolution coordinates
    const inv = 1 / scaleFactor;
    const scaledPts = rawPts.map(p => ({ x: Math.round(p.x * inv), y: Math.round(p.y * inv) }));
    corners = orderPoints(scaledPts) as [Corner, Corner, Corner, Corner];

    // Warp the original color image using full-resolution corners
    const { M, w, h } = buildTransform(corners);
    let dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(Math.round(w), Math.round(h)));
    M.delete();
    warpedCanvas = document.createElement('canvas');
    warpedCanvas.width = Math.round(w);
    warpedCanvas.height = Math.round(h);
    cv.imshow(warpedCanvas, dst);
    dst.delete();
  } else {
    // Fallback: no document found, return the full image as-is
    corners = [
      { x: 0, y: 0 },
      { x: src.cols - 1, y: 0 },
      { x: src.cols - 1, y: src.rows - 1 },
      { x: 0, y: src.rows - 1 },
    ] as [Corner, Corner, Corner, Corner];
    warpedCanvas = document.createElement('canvas');
    warpedCanvas.width = src.cols;
    warpedCanvas.height = src.rows;
    cv.imshow(warpedCanvas, src);
  }

  src.delete();

  return {
    corners,
    warped: warpedCanvas,
    width: warpedCanvas.width,
    height: warpedCanvas.height,
  };
}

function ptsFromMat(mat: any): Corner[] {
  const pts: Corner[] = [];
  for (let i = 0; i < 4; i++) {
    pts.push({ x: mat.intPtr(i, 0)[0], y: mat.intPtr(i, 0)[1] });
  }
  return pts;
}

/** Reject quads with any near-duplicate points (degenerate shapes) */
function isValidQuad(pts: Corner[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (dist(pts[i], pts[j]) < 10) return false;
    }
  }
  return true;
}

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
  const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y,
  ]);
  const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,     0,
    w - 1, 0,
    w - 1, h - 1,
    0,     h - 1,
  ]);
  const M = cv.getPerspectiveTransform(srcMat, dstMat);
  srcMat.delete();
  dstMat.delete();
  return { M, w, h };
}

function dist(a: Corner, b: Corner): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
