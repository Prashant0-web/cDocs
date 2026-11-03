export interface CapturedPage {
    id: string;
    url: string;
    file: File;
    name: string;
    hash?: string;
    dHash?: string;
}

/**
 * Computes SHA-256 cryptographic hash of a file's content in the browser
 */
export async function computeFileSha256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes 128-bit dual Difference Hash (dHash) in browser on HTML5 canvas in ~10ms.
 * Catches camera shots of the exact same paper taken twice by hand,
 * even with slight angle, lighting, zoom, or sensor differences.
 */
export async function computeImagePerceptualHash(file: File): Promise<string> {
    return new Promise((resolve) => {
        if (!file.type.startsWith("image/")) {
            resolve("");
            return;
        }

        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            try {
                // 1. Horizontal gradient hash (9x8 canvas -> 64 bits)
                const hCanvas = document.createElement("canvas");
                hCanvas.width = 9;
                hCanvas.height = 8;
                const hCtx = hCanvas.getContext("2d", { willReadFrequently: true });
                if (!hCtx) {
                    resolve("");
                    return;
                }
                hCtx.drawImage(img, 0, 0, 9, 8);
                const hData = hCtx.getImageData(0, 0, 9, 8).data;
                const hGray: number[] = [];
                for (let i = 0; i < 72; i++) {
                    const r = hData[i * 4] ?? 0;
                    const g = hData[i * 4 + 1] ?? 0;
                    const b = hData[i * 4 + 2] ?? 0;
                    hGray.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
                }
                let hHash = "";
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        hHash += (hGray[r * 9 + c] ?? 0) > (hGray[r * 9 + c + 1] ?? 0) ? "1" : "0";
                    }
                }

                // 2. Vertical gradient hash (8x9 canvas -> 64 bits)
                const vCanvas = document.createElement("canvas");
                vCanvas.width = 8;
                vCanvas.height = 9;
                const vCtx = vCanvas.getContext("2d", { willReadFrequently: true });
                if (!vCtx) {
                    resolve(hHash);
                    return;
                }
                vCtx.drawImage(img, 0, 0, 8, 9);
                const vData = vCtx.getImageData(0, 0, 8, 9).data;
                const vGray: number[] = [];
                for (let i = 0; i < 72; i++) {
                    const r = vData[i * 4] ?? 0;
                    const g = vData[i * 4 + 1] ?? 0;
                    const b = vData[i * 4 + 2] ?? 0;
                    vGray.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
                }
                let vHash = "";
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        vHash += (vGray[r * 8 + c] ?? 0) > (vGray[(r + 1) * 8 + c] ?? 0) ? "1" : "0";
                    }
                }

                resolve(hHash + vHash);
            } catch (err) {
                console.warn("dHash computation failed:", err);
                resolve("");
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve("");
        };

        img.src = url;
    });
}

export function calculateDHashDistance(h1: string, h2: string): number {
    if (!h1 || !h2 || h1.length !== h2.length) return 128;
    let dist = 0;
    for (let i = 0; i < h1.length; i++) {
        if (h1[i] !== h2[i]) dist++;
    }
    return dist;
}

/**
 * Client-side Image Optimizer:
 * Resizes photos to max 1600px at 0.78 quality, keeping text sharp while reducing size by 70-90%.
 */
export const compressImageForUpload = async (file: File, maxDim = 1600, quality = 0.78): Promise<File> => {
    if (!file.type.startsWith("image/")) return file;
    if (file.size <= 350 * 1024) return file;

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(file);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    (blob) => {
                        if (!blob || blob.size >= file.size) {
                            resolve(file);
                        } else {
                            const cleanName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                            const compressedFile = new File([blob], cleanName, {
                                type: "image/jpeg",
                                lastModified: Date.now(),
                            });
                            resolve(compressedFile);
                        }
                    },
                    "image/jpeg",
                    quality
                );
            };
            img.onerror = () => resolve(file);
            img.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
};
