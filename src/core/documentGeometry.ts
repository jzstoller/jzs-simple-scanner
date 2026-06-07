export interface Corner {
	x: number;
	y: number;
}

export function orderPoints(pts: Corner[]): Corner[] {
	const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
	const tl = sorted[0];
	const br = sorted[3];
	const [bl, tr] = sorted.slice(1, 3).sort((a, b) => a.x - b.x);
	return [tl, tr, br, bl];
}

export function buildTransform(
	pts: Corner[],
	cv: typeof import("@techstark/opencv-js"),
) {
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
		0, 0,
		w - 1, 0,
		w - 1, h - 1,
		0, h - 1,
	]);
	const M = cv.getPerspectiveTransform(srcMat, dstMat);
	srcMat.delete();
	dstMat.delete();
	return { M, w, h };
}

export function dist(a: Corner, b: Corner): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}