export interface OpenCVMat {
	rows: number;
	cols: number;
	delete(): void;
	ucharPtr(row: number, col: number): number[];
	intPtr(row: number, col: number): number[];
}

export interface OpenCVMatVector {
	size(): number;
	get(index: number): OpenCVMat;
	delete(): void;
}

export interface OpenCVModule {
	Mat: new (...args: any[]) => OpenCVMat;
	MatVector: new (...args: any[]) => OpenCVMatVector;
	Size: new (width: number, height: number) => unknown;
	CV_32FC2: number;
	COLOR_RGBA2RGB: number;
	COLOR_RGB2HSV: number;
	COLOR_RGBA2GRAY: number;
	THRESH_BINARY_INV: number;
	THRESH_BINARY: number;
	ADAPTIVE_THRESH_GAUSSIAN_C: number;
	MORPH_RECT: number;
	MORPH_OPEN: number;
	MORPH_CLOSE: number;
	RETR_LIST: number;
	CHAIN_APPROX_SIMPLE: number;
	BORDER_DEFAULT: number;
	matFromArray(rows: number, cols: number, type: number, data: number[]): OpenCVMat;
	matFromImageData?(imageData: ImageData): OpenCVMat;
	imread(source: HTMLCanvasElement): OpenCVMat;
	resize(source: OpenCVMat, destination: OpenCVMat, size: unknown, scaleX?: number, scaleY?: number): void;
	cvtColor(source: OpenCVMat, destination: OpenCVMat, code: number): void;
	split(source: OpenCVMat, destination: OpenCVMatVector): void;
	threshold(source: OpenCVMat, destination: OpenCVMat, threshold: number, maxValue: number, type: number): void;
	bitwise_and(source1: OpenCVMat, source2: OpenCVMat, destination: OpenCVMat): void;
	bilateralFilter(source: OpenCVMat, destination: OpenCVMat, diameter: number, sigmaColor: number, sigmaSpace: number, borderType: number): void;
	Canny(source: OpenCVMat, destination: OpenCVMat, threshold1: number, threshold2: number): void;
	getStructuringElement(shape: number, size: unknown): OpenCVMat;
	dilate(source: OpenCVMat, destination: OpenCVMat, kernel: OpenCVMat): void;
	adaptiveThreshold(source: OpenCVMat, destination: OpenCVMat, maxValue: number, adaptiveMethod: number, thresholdType: number, blockSize: number, C: number): void;
	morphologyEx(source: OpenCVMat, destination: OpenCVMat, op: number, kernel: OpenCVMat): void;
	findContours(source: OpenCVMat, contours: OpenCVMatVector, hierarchy: OpenCVMat, mode: number, method: number): void;
	contourArea(contour: OpenCVMat): number;
	convexHull(source: OpenCVMat, destination: OpenCVMat): void;
	arcLength(curve: OpenCVMat, closed: boolean): number;
	approxPolyDP(curve: OpenCVMat, destination: OpenCVMat, epsilon: number, closed: boolean): void;
	getPerspectiveTransform(source: OpenCVMat, destination: OpenCVMat): OpenCVMat;
	warpPerspective(source: OpenCVMat, destination: OpenCVMat, transform: OpenCVMat, size: unknown): void;
	imshow(canvas: HTMLCanvasElement, source: OpenCVMat): void;
}