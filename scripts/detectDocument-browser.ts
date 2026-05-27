// detectDocument-browser.ts
// OpenCV.js (WebAssembly) document detection for browser/Obsidian plugin

export interface Corner {
  x: number;
  y: number;
}

export interface DetectDebug {
  srcRows: number;
  srcCols: number;
  srcType: number;
  srcSamplePixel: number[];  // [R, G, B, A] of pixel at (0,0)
  dstRows: number;
  dstCols: number;
  dstSamplePixel: number[];  // [R, G, B, A] of pixel at (0,0)
  warpScaleUsed: number;
}

export interface DetectResult {
  corners: [Corner, Corner, Corner, Corner];
  warped: HTMLCanvasElement;
  width: number;
  height: number;
  debug?: DetectDebug;
}

export function detectDocument(imageSource: HTMLImageElement | HTMLCanvasElement): DetectResult {
  // Pre-draw to an explicit canvas to work around cv.imread issues with
  // HTMLImageElement in WKWebView / Electron (image not in DOM, etc.)
  const naturalW = (imageSource as HTMLImageElement).naturalWidth
    || (imageSource as HTMLCanvasElement).width;
  const naturalH = (imageSource as HTMLImageElement).naturalHeight
    || (imageSource as HTMLCanvasElement).height;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = naturalW;
  srcCanvas.height = naturalH;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(imageSource, 0, 0);

  const src = cv.imread(srcCanvas);

  // Scale down to max 1500px for reliable, fast detection on high-res phone photos
  const MAX_DIM = 1500;
  const scaleFactor = Math.min(MAX_DIM / src.cols, MAX_DIM / src.rows, 1.0);
  let small = new cv.Mat();
  if (scaleFactor < 1.0) {
    cv.resize(src, small, new cv.Size(Math.round(src.cols * scaleFactor), Math.round(src.rows * scaleFactor)));
  } else {
    src.copyTo(small);
  }

  // Grayscale → Blur → Adaptive Threshold → Canny Edges → Contours
  let gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY, 0);
  let blurred = new cv.Mat();
  const ksize = new cv.Size(5, 5);
  cv.GaussianBlur(gray, blurred, ksize, 0);
  
  // Adaptive threshold
  let binary = new cv.Mat();
  cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
  
  // Canny edges on the threshold
  let edges = new cv.Mat();
  cv.Canny(binary, edges, 75, 200);
  
  // Find contours on edges
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Find the largest valid 4-point contour (must be >3% of image area)
  const minArea = small.cols * small.rows * 0.03;
  let maxArea = minArea;
  let bestContour: any = null;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    // More aggressive epsilon to force simplification to 4 points
    cv.approxPolyDP(cnt, approx, 0.05 * peri, true);
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
  small.delete(); gray.delete(); blurred.delete(); binary.delete(); edges.delete();
  contours.delete(); hierarchy.delete();

  // Sample a pixel from src to verify cv.imread produced real data
  const srcSamplePixel: number[] = src.rows > 0 && src.cols > 0
    ? [src.ucharPtr(0, 0)[0], src.ucharPtr(0, 0)[1], src.ucharPtr(0, 0)[2], src.ucharPtr(0, 0)[3]]
    : [-1, -1, -1, -1];

  // Cap warp resolution to avoid WASM heap exhaustion on memory-constrained devices (e.g. iOS).
  // 2000px on the longer side is plenty for high-quality document scans.
  const MAX_WARP_DIM = 2000;
  const warpScale = Math.min(MAX_WARP_DIM / src.cols, MAX_WARP_DIM / src.rows, 1.0);

  let warpedCanvas: HTMLCanvasElement;
  let corners: [Corner, Corner, Corner, Corner];
  let dstSamplePixel: number[] = [-1, -1, -1, -1];

  if (bestContour) {
    const rawPts = ptsFromMat(bestContour);
    bestContour.delete();
    // Scale corners back to original full-resolution coordinates
    const inv = 1 / scaleFactor;
    const scaledPts = rawPts.map(p => ({ x: Math.round(p.x * inv), y: Math.round(p.y * inv) }));
    corners = orderPoints(scaledPts) as [Corner, Corner, Corner, Corner];

    // Down-scale source for warp if needed, then scale corners accordingly
    let warpSrc = src;
    let warpCorners = corners;
    if (warpScale < 1.0) {
      warpSrc = new cv.Mat();
      cv.resize(src, warpSrc, new cv.Size(
        Math.round(src.cols * warpScale),
        Math.round(src.rows * warpScale)
      ));
      warpCorners = corners.map(p => ({
        x: Math.round(p.x * warpScale),
        y: Math.round(p.y * warpScale),
      })) as [Corner, Corner, Corner, Corner];
    }

    const { M, w, h } = buildTransform(warpCorners);
    let dst = new cv.Mat();
    cv.warpPerspective(warpSrc, dst, M, new cv.Size(Math.round(w), Math.round(h)));
    M.delete();
    if (warpSrc !== src) warpSrc.delete();

    dstSamplePixel = dst.rows > 0 && dst.cols > 0
      ? [dst.ucharPtr(Math.floor(dst.rows / 2), Math.floor(dst.cols / 2))[0],
         dst.ucharPtr(Math.floor(dst.rows / 2), Math.floor(dst.cols / 2))[1],
         dst.ucharPtr(Math.floor(dst.rows / 2), Math.floor(dst.cols / 2))[2],
         dst.ucharPtr(Math.floor(dst.rows / 2), Math.floor(dst.cols / 2))[3]]
      : [-1, -1, -1, -1];

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

    let fallbackSrc = src;
    if (warpScale < 1.0) {
      fallbackSrc = new cv.Mat();
      cv.resize(src, fallbackSrc, new cv.Size(
        Math.round(src.cols * warpScale),
        Math.round(src.rows * warpScale)
      ));
    }
    warpedCanvas = document.createElement('canvas');
    warpedCanvas.width = fallbackSrc.cols;
    warpedCanvas.height = fallbackSrc.rows;
    cv.imshow(warpedCanvas, fallbackSrc);
    if (fallbackSrc !== src) fallbackSrc.delete();
  }

  // Capture src metadata before deleting
  const srcRows = src.rows;
  const srcCols = src.cols;
  const srcType = src.type();
  src.delete();

  return {
    corners,
    warped: warpedCanvas,
    width: warpedCanvas.width,
    height: warpedCanvas.height,
    debug: {
      srcRows,
      srcCols,
      srcType,
      srcSamplePixel,
      dstRows: warpedCanvas.height,
      dstCols: warpedCanvas.width,
      dstSamplePixel,
      warpScaleUsed: warpScale,
    },
  };
}

/**
 * Creates a debug overlay image showing the detected crop box on the original image.
 * @param imageSource Original image (HTMLImageElement or HTMLCanvasElement)
 * @param corners Detected corners [tl, tr, br, bl]
 * @returns Canvas with the crop box overlay
 */
export function createDebugOverlay(
  imageSource: HTMLImageElement | HTMLCanvasElement,
  corners: [Corner, Corner, Corner, Corner]
): HTMLCanvasElement {
  const naturalW = (imageSource as HTMLImageElement).naturalWidth
    || (imageSource as HTMLCanvasElement).width;
  const naturalH = (imageSource as HTMLImageElement).naturalHeight
    || (imageSource as HTMLCanvasElement).height;

  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d')!;

  // Draw the original image
  ctx.drawImage(imageSource, 0, 0);

  // Draw the detected quadrilateral with colored corner points
  const labels = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const colors = ['#ff2a2a', '#2a7fff', '#2aff2a', '#ffea2a'];

  // Draw the polyline connecting corners
  ctx.strokeStyle = '#ff2a2a';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.stroke();

  // Draw colored circles at each corner
  const radius = 16;
  corners.forEach((pt, i) => {
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
    ctx.fill();
  });

  return canvas;
}

function ptsFromMat(mat: any): Corner[] {
  const pts: Corner[] = [];
  for (let i = 0; i < 4; i++) {
    pts.push({ x: mat.intPtr(i, 0)[0], y: mat.intPtr(i, 0)[1] });
  }
  return pts;
}

/** Validate if quad looks like a rectangular document */
function isValidQuad(pts: Corner[]): boolean {
  // Check for near-duplicate points (degenerate shapes)
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (dist(pts[i], pts[j]) < 10) return false;
    }
  }
  
  const ordered = orderPoints(pts);
  const [tl, tr, br, bl] = ordered;
  
  // Get all 4 side lengths
  const topDist = dist(tl, tr);
  const bottomDist = dist(bl, br);
  const leftDist = dist(tl, bl);
  const rightDist = dist(tr, br);
  
  // Check aspect ratio - documents are typically 0.5 to 2.5 (portrait to landscape)
  // Check aspect ratio - documents are typically 0.3 to 3.0 (portrait to landscape)
  const widthAvg = (topDist + bottomDist) / 2;
  const heightAvg = (leftDist + rightDist) / 2;
  const aspectRatio = widthAvg / heightAvg;
  
  if (aspectRatio < 0.3 || aspectRatio > 3.0) return false;
  
  // Check that opposite sides are similar (reject trapezoids)
  // Top and bottom should be similar length
  const topBottomRatio = Math.max(topDist, bottomDist) / Math.min(topDist, bottomDist);
  if (topBottomRatio > 1.5) return false;  // more strict than before
  
  // Left and right should be similar length
  const leftRightRatio = Math.max(leftDist, rightDist) / Math.min(leftDist, rightDist);
  if (leftRightRatio > 1.5) return false;
  
  // Check that all sides have reasonable length (not tiny)
  const minSideLength = Math.min(topDist, bottomDist, leftDist, rightDist);
  if (minSideLength < 20) return false;
  
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
