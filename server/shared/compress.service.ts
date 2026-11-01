import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

// Configure Sharp memory and thread pool to prevent performance bottlenecks
sharp.cache({ memory: 64, files: 20, items: 100 });
// Limit libvips thread pool concurrency to 2 so other Express endpoints stay fast
sharp.concurrency(2);

export interface DocumentOptimizeOptions {
    /**
     * Maximum dimension in pixels for document width (default: 2048).
     * 2048px gives ~300 DPI on standard A4 print, keeping tiny fractions & text crisp.
     */
    maxWidth?: number | undefined;
    /**
     * Maximum dimension in pixels for document height (default: 2048).
     */
    maxHeight?: number | undefined;
    /**
     * Image quality between 1 and 100 (default: 82).
     * 82 preserves character edges with zero visible compression artifacts.
     */
    quality?: number | undefined;
    /**
     * Target image format (default: 'webp').
     */
    format?: ("webp" | "jpeg") | undefined;
    /**
     * Automatically enhance contrast between faded ink/pencil and grey paper (default: true).
     */
    enhanceContrast?: boolean | undefined;
    /**
     * Subtly sharpen character contours to make handwriting and print clearer (default: true).
     */
    sharpenText?: boolean | undefined;
    /**
     * Convert to grayscale if paper is monochrome (reduces another ~40% file size).
     */
    grayscale?: boolean | undefined;
}

export interface OptimizedImageResult {
    buffer: Buffer;
    format: "webp" | "jpeg";
    contentType: string;
    originalSize: number;
    compressedSize: number;
    width?: number | undefined;
    height?: number | undefined;
    compressionRatio: string;
}

/**
 * Optimizes an image document specifically for text readability while achieving 80-95% compression.
 * Handles EXIF auto-rotation from smartphone cameras so papers are never upside-down.
 */
export const optimizeDocumentImage = async (
    inputBuffer: Buffer,
    options?: DocumentOptimizeOptions
): Promise<OptimizedImageResult> => {
    const maxWidth = options?.maxWidth ?? 2048;
    const maxHeight = options?.maxHeight ?? 2048;
    const quality = options?.quality ?? 82;
    const format = options?.format ?? "webp";
    const enhanceContrast = options?.enhanceContrast ?? true;
    const sharpenText = options?.sharpenText ?? true;
    const grayscale = options?.grayscale ?? false;

    // Start sharp pipeline with auto-rotation (respects EXIF orientation from phone cameras)
    let pipeline = sharp(inputBuffer, { failOn: "none" }).rotate();

    // Resize within bounds while keeping aspect ratio (does not enlarge small images)
    pipeline = pipeline.resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
    });

    // Optional grayscale conversion
    if (grayscale) {
        pipeline = pipeline.grayscale();
    }

    // Auto-normalize contrast so grey background paper becomes brighter and ink stays dark
    if (enhanceContrast) {
        pipeline = pipeline.normalize();
    }

    // Subtle edge sharpening for handwritten text and math symbols
    if (sharpenText) {
        pipeline = pipeline.sharpen({
            sigma: 1.0,
            m1: 0.5,
            m2: 1.5,
        });
    }

    let outputBuffer: Buffer;
    let contentType: string;

    if (format === "webp") {
        outputBuffer = await pipeline
            .webp({
                quality,
                effort: 4,
            })
            .toBuffer();
        contentType = "image/webp";
    } else {
        outputBuffer = await pipeline
            .jpeg({
                quality,
                mozjpeg: true,
            })
            .toBuffer();
        contentType = "image/jpeg";
    }

    // Read metadata of final compressed output
    const meta = await sharp(outputBuffer).metadata();
    const originalSize = inputBuffer.length;
    const compressedSize = outputBuffer.length;
    const savings = originalSize > 0 ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(1) : "0";

    return {
        buffer: outputBuffer,
        format,
        contentType,
        originalSize,
        compressedSize,
        width: meta.width,
        height: meta.height,
        compressionRatio: `${savings}%`,
    };
};

/**
 * Optimizes a batch of images (e.g., pages of an exam paper) with controlled concurrency
 * to keep server CPU usage predictable.
 */
export const batchOptimizeDocumentImages = async (
    images: Buffer[],
    options?: DocumentOptimizeOptions,
    concurrency: number = 2
): Promise<OptimizedImageResult[]> => {
    const results: OptimizedImageResult[] = [];
    let currentIndex = 0;

    const worker = async () => {
        while (currentIndex < images.length) {
            const idx = currentIndex++;
            const buffer = images[idx];
            if (!buffer) break;

            try {
                const opt = await optimizeDocumentImage(buffer, options);
                results[idx] = opt;
            } catch (err: any) {
                console.error(`[Document Compression] Failed processing page index ${idx}:`, err.message);
                throw err;
            }
        }
    };

    const workers = Array.from({ length: Math.min(concurrency, images.length) }, () => worker());
    await Promise.all(workers);

    return results;
};

export interface CompilePdfOptions {
    title?: string | undefined;
    subject?: string | undefined;
    author?: string | undefined;
}

/**
 * Compiles a group of page images into a single clean PDF document.
 * Fits images gracefully onto standard pages with margin padding.
 */
export const compileImagesToPdf = async (
    images: Buffer[],
    options?: CompilePdfOptions
): Promise<Buffer> => {
    if (images.length === 0) {
        throw new Error("No images provided to compile PDF");
    }

    const pdfDoc = await PDFDocument.create();
    if (options?.title) {
        pdfDoc.setTitle(options.title);
    }
    if (options?.subject) {
        pdfDoc.setSubject(options.subject);
    }
    pdfDoc.setAuthor(options?.author || "cDocs (Community Docs)");
    pdfDoc.setProducer("cDocs Paper Compression Engine");

    // Standard A4 dimensions in PDF points (72 points = 1 inch)
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;

    // Adaptive compression: target maximum ~2.8MB total for the entire compiled PDF
    // If there are many pages (e.g. 6-10), tune quality and dimensions accordingly
    const targetQuality = images.length > 6 ? 60 : images.length > 3 ? 68 : 72;
    const targetWidth = images.length > 6 ? 1200 : 1400;
    const targetHeight = images.length > 6 ? 1700 : 2000;

    for (const imgBuffer of images) {
        // Optimize and compress image for high text readability with maximum compression
        const jpegBuffer = await sharp(imgBuffer)
            .rotate()
            .resize({
                width: targetWidth,
                height: targetHeight,
                fit: "inside",
                withoutEnlargement: true,
            })
            .normalize() // Enhances contrast: grey paper becomes brighter, ink remains dark & clear
            .sharpen({ sigma: 1.0, m1: 0.5, m2: 1.5 }) // Sharpens small characters & math symbols
            .jpeg({
                quality: targetQuality,
                mozjpeg: true,
                trellisQuantisation: true,
                overshootDeringing: true,
            })
            .toBuffer();

        const embeddedImage = await pdfDoc.embedJpg(jpegBuffer);
        const { width: imgW, height: imgH } = embeddedImage;

        // Calculate scaling to fit within A4 while preserving aspect ratio
        const margin = 20;
        const maxWidth = A4_WIDTH - margin * 2;
        const maxHeight = A4_HEIGHT - margin * 2;

        const scale = Math.min(maxWidth / imgW, maxHeight / imgH, 1.0);
        const drawWidth = imgW * scale;
        const drawHeight = imgH * scale;

        // Center on the page
        const x = (A4_WIDTH - drawWidth) / 2;
        const y = (A4_HEIGHT - drawHeight) / 2;

        const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
        page.drawImage(embeddedImage, {
            x,
            y,
            width: drawWidth,
            height: drawHeight,
        });
    }

    let pdfBytes = await pdfDoc.save();

    // Fallback safeguard: if final PDF unexpectedly exceeds 3 MB, re-compress with stronger compression
    if (pdfBytes.length > 3 * 1024 * 1024 && images.length > 0) {
        console.warn(`[PDF Compression] PDF size ${pdfBytes.length} exceeds 3 MB limit, applying aggressive pass...`);
        const fallbackDoc = await PDFDocument.create();
        if (options?.title) fallbackDoc.setTitle(options.title);
        if (options?.subject) fallbackDoc.setSubject(options.subject);
        fallbackDoc.setAuthor(options?.author || "cDocs (Community Docs)");

        for (const imgBuffer of images) {
            const fallbackJpeg = await sharp(imgBuffer)
                .rotate()
                .resize({ width: 1050, height: 1500, fit: "inside", withoutEnlargement: true })
                .normalize()
                .jpeg({ quality: 50, mozjpeg: true })
                .toBuffer();

            const embedded = await fallbackDoc.embedJpg(fallbackJpeg);
            const { width: imgW, height: imgH } = embedded;
            const margin = 20;
            const maxWidth = A4_WIDTH - margin * 2;
            const maxHeight = A4_HEIGHT - margin * 2;
            const scale = Math.min(maxWidth / imgW, maxHeight / imgH, 1.0);
            const drawWidth = imgW * scale;
            const drawHeight = imgH * scale;
            const x = (A4_WIDTH - drawWidth) / 2;
            const y = (A4_HEIGHT - drawHeight) / 2;
            const page = fallbackDoc.addPage([A4_WIDTH, A4_HEIGHT]);
            page.drawImage(embedded, { x, y, width: drawWidth, height: drawHeight });
        }
        pdfBytes = await fallbackDoc.save();
    }

    return Buffer.from(pdfBytes);
};

export interface ProcessedDocumentBundle {
    pages: Array<{
        pageIndex: number;
        buffer: Buffer;
        contentType: string;
        format: string;
        size: number;
        width?: number | undefined;
        height?: number | undefined;
    }>;
    compiledPdf?: {
        buffer: Buffer;
        size: number;
        contentType: "application/pdf";
    } | undefined;
    totalOriginalSize: number;
    totalCompressedSize: number;
    overallSavings: string;
}

/**
 * High-level helper: Ingests a set of files (either a single PDF or a group of page photos),
 * optimizes the page images, optionally generates a compiled master PDF, and prepares
 * everything for R2 storage.
 */
export const processDocumentUploadBundle = async (
    files: Array<{ buffer: Buffer; mimetype: string; originalname?: string | undefined }>,
    options?: {
        generateCompiledPdf?: boolean | undefined;
        title?: string | undefined;
        optimizeOptions?: DocumentOptimizeOptions | undefined;
    }
): Promise<ProcessedDocumentBundle> => {
    if (!files || files.length === 0) {
        throw new Error("No files uploaded");
    }

    const firstFile = files[0];
    const totalOriginalSize = files.reduce((sum, f) => sum + f.buffer.length, 0);

    // Case 1: Single PDF upload
    if (files.length === 1 && firstFile && firstFile.mimetype === "application/pdf") {
        return {
            pages: [],
            compiledPdf: {
                buffer: firstFile.buffer,
                size: firstFile.buffer.length,
                contentType: "application/pdf",
            },
            totalOriginalSize,
            totalCompressedSize: firstFile.buffer.length,
            overallSavings: "0% (Native PDF)",
        };
    }

    // Case 2: Group of images / photo pages
    const imageBuffers = files.map((f) => f.buffer);
    const optimizedPages = await batchOptimizeDocumentImages(imageBuffers, options?.optimizeOptions);

    const pagesResult = optimizedPages.map((opt, idx) => ({
        pageIndex: idx + 1,
        buffer: opt.buffer,
        contentType: opt.contentType,
        format: opt.format,
        size: opt.compressedSize,
        width: opt.width,
        height: opt.height,
    }));

    let compiledPdfResult: ProcessedDocumentBundle["compiledPdf"] = undefined;
    if (options?.generateCompiledPdf !== false) {
        try {
            const compileOpts: CompilePdfOptions = {};
            if (options?.title) compileOpts.title = options.title;

            const pdfBuffer = await compileImagesToPdf(
                optimizedPages.map((p) => p.buffer),
                compileOpts
            );
            compiledPdfResult = {
                buffer: pdfBuffer,
                size: pdfBuffer.length,
                contentType: "application/pdf",
            };
        } catch (pdfErr: any) {
            console.warn("[Document Process] Warning: could not compile PDF bundle:", pdfErr.message);
        }
    }

    const totalCompressedSize = pagesResult.reduce((sum, p) => sum + p.size, 0);
    const savings =
        totalOriginalSize > 0
            ? (((totalOriginalSize - totalCompressedSize) / totalOriginalSize) * 100).toFixed(1)
            : "0";

    return {
        pages: pagesResult,
        compiledPdf: compiledPdfResult,
        totalOriginalSize,
        totalCompressedSize,
        overallSavings: `${savings}%`,
    };
};
