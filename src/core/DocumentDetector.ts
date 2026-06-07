// detectDocument-browser.ts
// OpenCV.js (WebAssembly) document detection for browser/Obsidian plugin

// cv is loaded at runtime via CDN (see opencv-loader.ts).
// It is read from window.cv at call-time inside each function to avoid relying on
// esbuild's free-variable resolution, which differs between window and global in Electron.

import { Corner, buildTransform, orderPoints } from "./documentGeometry";

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

export function detectDocument(imageSource: HTMLImageElement | HTMLCanvasElement, logger?: (msg: string) => void): DetectResult {
  // Bind cv from window at call-time; loadOpenCV() must have resolved before this is called.
  const cv = (window as any).cv as typeof import("@techstark/opencv-js");
  const log = (msg: string) => {
    if (logger) logger(msg);
    console.log('[detectDocument] ' + msg);
  };

  try {
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

    const ctx = srcCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas 2D context');
    const imageData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

    let src: any;
    if (typeof (window as any).cv.matFromImageData === 'function') {
      src = cv.matFromImageData(imageData);
    } else {
      src = cv.imread(srcCanvas);
    }

    // Stage 1: Preprocessing
    // Resize to ~1200px width for speed
    let resized = new cv.Mat();
    const scale = Math.min(1.0, 1200 / src.cols);
    cv.resize(src, resized, new cv.Size(0, 0), scale, scale);

    // Extract saturation and value channels for paper detection
    const rgb = new cv.Mat();
    cv.cvtColor(resized, rgb, cv.COLOR_RGBA2RGB);
    const hsv = new cv.Mat();
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    rgb.delete();

    const hsvChannels = new cv.MatVector();
    cv.split(hsv, hsvChannels);
    const saturation = hsvChannels.get(1);  // S channel
    const value      = hsvChannels.get(2);  // V channel
    hsvChannels.delete();

    const satMask = new cv.Mat();
    cv.threshold(saturation, satMask, 100, 255, cv.THRESH_BINARY_INV);

    const valMask = new cv.Mat();
    cv.threshold(value, valMask, 120, 255, cv.THRESH_BINARY);

    cv.bitwise_and(satMask, valMask, satMask);
    valMask.delete();
    value.delete();

    // Convert to grayscale
    let gray = new cv.Mat();
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);

    // Bilateral filter (suppress texture, preserve edges)
    let smooth = new cv.Mat();
    cv.bilateralFilter(gray, smooth, 9, 75, 75, cv.BORDER_DEFAULT);

    // Stage 2: Create Multiple Detection Maps
    // A. Edge Map
    let edges = new cv.Mat();
    cv.Canny(smooth, edges, 50, 150);

    // Dilate to thicken edges
    const kernelRect = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.dilate(edges, edges, kernelRect);

    // B. Adaptive Brightness Map
    let thresh = new cv.Mat();
    cv.adaptiveThreshold(smooth, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 15);

    // C. Morphological Cleanup
    cv.morphologyEx(thresh, thresh, cv.MORPH_OPEN, kernelRect);
    cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernelRect);

    // Stage 3: Combine Signals (edge AND brightness)
    let combined = new cv.Mat();
    cv.bitwise_and(thresh, edges, combined);

    // Apply saturation mask to suppress carpet interference
    cv.bitwise_and(combined, satMask, combined);

    // Stage 4: Find Contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(combined, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    // Stage 5-6: Find largest contour and apply hull + approximation
    let bestCnt: any = null;
    let maxArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > maxArea) {
        maxArea = area;
        if (bestCnt) bestCnt.delete();
        bestCnt = cnt;
      } else {
        cnt.delete();
      }
    }

    // Compute convex hull to smooth out squiggly edges
    let approx: any = null;
    if (bestCnt) {
      const hull = new cv.Mat();
      approx = new cv.Mat();
      cv.convexHull(bestCnt, hull);
      const peri = cv.arcLength(hull, true);
      cv.approxPolyDP(hull, approx, 0.04 * peri, true);
      hull.delete();
      bestCnt.delete();
    }

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

    if (approx && approx.rows > 0) {
      // Extract corner points from approx
      const pts: Corner[] = [];
      for (let i = 0; i < approx.rows; i++) {
        pts.push({
          x: approx.intPtr(i, 0)[0],
          y: approx.intPtr(i, 0)[1]
        });
      }
      approx.delete();

      // Scale corners back to original full-resolution coordinates
      const inv = 1 / scale;
    const scaledPts = pts.map(p => ({ x: Math.round(p.x * inv), y: Math.round(p.y * inv) }));
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

    const { M, w, h } = buildTransform(warpCorners, cv);
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
    if (approx) approx.delete();

    corners = [
      { x: 0, y: 0 },
      { x: src.cols - 1, y: 0 },
      { x: src.cols - 1, y: src.rows - 1 },
      { x: 0, y: src.rows - 1 },
    ] as [Corner, Corner, Corner, Corner];

    log('Using fallback (no valid corners detected)');
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

    // Cleanup
    resized.delete();
    gray.delete();
    smooth.delete();
    hsv.delete();
    saturation.delete();
    satMask.delete();
    edges.delete();
    thresh.delete();
    combined.delete();
    kernelRect.delete();
    contours.delete();
    hierarchy.delete();

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
  } catch (error) {
    log('ERROR: ' + (error instanceof Error ? error.message : String(error)));
    if (logger) logger('Stack: ' + (error instanceof Error ? error.stack : 'no stack'));
    throw error;
  }
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
