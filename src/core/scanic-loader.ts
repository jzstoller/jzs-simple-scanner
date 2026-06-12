import { Scanner } from "scanic";

let scanner: Scanner | null = null;

export async function initScanic(): Promise<void> {
    if (scanner) return;

    scanner = new Scanner();
    await scanner.initialize();
}

export async function scanBlob(blob: Blob): Promise<string> {
    if (!scanner) {
        await initScanic();
    }

    const img = await blobToImage(blob);
    const firstPass = await scanner!.scan(img, {
        mode: "extract",
        output: "canvas",
    });

    let result = firstPass;
    if (looksLikeFullFrame(firstPass, img)) {
        const fallbackPass = await scanner!.scan(img, {
            mode: "extract",
            output: "canvas",
            maxProcessingDimension: 1600,
            maxCandidateContours: 20,
            minDocumentCoverageRatio: 0.02,
            minDocumentFillRatio: 0.05,
            minContourFitRatio: 0.08,
            minDocumentSideRatio: 0.03,
            maxDocumentAspectRatio: 12,
            minCascadeTriggerConfidence: 0.82,
            applyDilation: true,
            dilationKernelSize: 5,
            dilationIterations: 2,
        });

        if (fallbackPass.success && fallbackPass.output) {
            result = fallbackPass;
        }
    }

    const out = result.output;

    if (!result.success || !out) {
        throw new Error("No document detected");
    }

    // Explicit type narrowing — required by TS
    if (out instanceof HTMLCanvasElement) {
        return out.toDataURL("image/png");
    }

    if (typeof OffscreenCanvas !== "undefined" && out instanceof OffscreenCanvas) {
        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        canvas.getContext("2d")!.drawImage(out, 0, 0);
        return canvas.toDataURL("image/png");
    }

    if (typeof out === "string") {
        // Scanic sometimes returns a data URL directly
        return out;
    }

    if (out instanceof ImageData) {
        // Convert ImageData → Canvas → PNG
        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        canvas.getContext("2d")!.putImageData(out, 0, 0);
        return canvas.toDataURL("image/png");
    }

    throw new Error("Unsupported Scanic output type");
}

export async function scanElement(
    element: HTMLImageElement | HTMLCanvasElement
) {
    if (!scanner) {
        await initScanic();
    }

    const result = await scanner!.scan(element, { mode: "extract" });

    if (!result.success || !result.output) {
        throw new Error("No document detected");
    }

    return result; // output is now guaranteed non-null
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

function looksLikeFullFrame(
    result: Awaited<ReturnType<Scanner["scan"]>>,
    image: HTMLImageElement,
): boolean {
    const corners = result.corners;
    if (!result.success || !corners) {
        return false;
    }

    const imageArea = image.naturalWidth * image.naturalHeight;
    if (imageArea <= 0) {
        return false;
    }

    const cornerArea = polygonArea([
        corners.topLeft,
        corners.topRight,
        corners.bottomRight,
        corners.bottomLeft,
    ]);

    return cornerArea / imageArea > 0.85;
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
    let area = 0;

    for (let index = 0; index < points.length; index++) {
        const nextIndex = (index + 1) % points.length;
        area += points[index].x * points[nextIndex].y;
        area -= points[nextIndex].x * points[index].y;
    }

    return Math.abs(area / 2);
}
