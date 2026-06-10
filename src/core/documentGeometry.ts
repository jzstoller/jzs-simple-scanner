export interface Corner {
	x: number;
	y: number;
}

import type { OpenCVModule } from "./opencv-types";

export function orderPoints(pts: Corner[]): Corner[] {
	const sorted = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
	const tl = sorted[0];
	const br = sorted[3];
	const [bl, tr] = sorted.slice(1, 3).sort((a, b) => a.x - b.x);
	return [tl, tr, br, bl];
}

export function buildTransform(pts: Corner[], cv: OpenCVModule) {
	const [tl, tr, br, bl] = pts;
	const w = Math.max(dist(tl, tr), dist(bl, br));
	const h = Math.max(dist(tl, bl), dist(tr, br));
	const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
		tl.x,
		tl.y,
		tr.x,
		tr.y,
		br.x,
		br.y,
		bl.x,
		bl.y,
	]);
	const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
		0,
		0,
		w - 1,
		0,
		w - 1,
		h - 1,
		0,
		h - 1,
	]);
	const M = cv.getPerspectiveTransform(srcMat, dstMat);
	srcMat.delete();
	dstMat.delete();
	return { M, w, h };
}

export function dist(a: Corner, b: Corner): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ptsFromMat(mat: any): Corner[] {
	const pts: Corner[] = [];
	for (let i = 0; i < 4; i++) {
		const ip = mat.intPtr(i, 0) as Int32Array;
		pts.push({ x: ip[0], y: ip[1] });
	}
	return pts;
}

export function isValidQuad(pts: Corner[]): boolean {
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			if (dist(pts[i], pts[j]) < 10) return false;
		}
	}

	const [tl, tr, br, bl] = orderPoints(pts);

	const topDist = dist(tl, tr);
	const bottomDist = dist(bl, br);
	const leftDist = dist(tl, bl);
	const rightDist = dist(tr, br);

	const widthAvg = (topDist + bottomDist) / 2;
	const heightAvg = (leftDist + rightDist) / 2;
	const aspectRatio = widthAvg / heightAvg;

	if (aspectRatio < 0.3 || aspectRatio > 3.0) return false;

	const topBottomRatio =
		Math.max(topDist, bottomDist) / Math.min(topDist, bottomDist);
	if (topBottomRatio > 1.5) return false;

	const leftRightRatio =
		Math.max(leftDist, rightDist) / Math.min(leftDist, rightDist);
	if (leftRightRatio > 1.5) return false;

	const minSideLength = Math.min(topDist, bottomDist, leftDist, rightDist);
	if (minSideLength < 20) return false;

	return true;
}

export function quadOverlapsPaper(pts: Corner[], paperMask: any): boolean {
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);

	const x0 = Math.max(0, Math.min(...xs));
	const y0 = Math.max(0, Math.min(...ys));
	const x1 = Math.min(paperMask.cols - 1, Math.max(...xs));
	const y1 = Math.min(paperMask.rows - 1, Math.max(...ys));

	let paperPixels = 0;
	let total = 0;
	const step = 10;

	for (let y = y0; y <= y1; y += step) {
		for (let x = x0; x <= x1; x += step) {
			if (paperMask.ucharAt(y, x) > 0) paperPixels++;
			total++;
		}
	}

	return total > 0 && paperPixels / total > 0.15;
}
