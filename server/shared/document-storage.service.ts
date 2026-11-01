import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
    uploadToR2,
    uploadBatchToR2,
    deleteBatchFromR2,
    readFromR2Stream,
    readFromR2Buffer,
    getR2PublicUrl,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    type R2BatchUploadItem,
} from "./r2.service.js";
import {
    processDocumentUploadBundle,
    type DocumentOptimizeOptions,
} from "./compress.service.js";

export interface DocumentUploadInput {
    /**
     * Unique identifier for document (auto-generated if omitted)
     */
    docId?: string | undefined;
    /**
     * Array of uploaded file buffers (images or PDF)
     */
    files: Array<{
        buffer: Buffer;
        mimetype: string;
        originalname?: string | undefined;
    }>;
    /**
     * Metadata options
     */
    title?: string | undefined;
    userId?: string | undefined;
    subjectCode?: string | undefined;
    college?: string | undefined;
    examYear?: string | undefined;
    /**
     * Custom compression configuration
     */
    compressionOptions?: DocumentOptimizeOptions | undefined;
}

export interface StoredDocumentPage {
    pageNumber: number;
    key: string;
    publicUrl: string;
    contentType: string;
    size: number;
    width?: number | undefined;
    height?: number | undefined;
}

export interface DocumentUploadResponse {
    docId: string;
    title?: string | undefined;
    /**
     * Public URL to the master compiled PDF document
     */
    pdfUrl?: string | undefined;
    pdfKey?: string | undefined;
    pdfSize?: number | undefined;
    thumbnailUrl?: string | undefined;
    thumbnailKey?: string | undefined;
    /**
     * Individual high-resolution optimized pages for quick in-browser thumbnail or carousel viewing
     */
    pages: StoredDocumentPage[];
    totalPages: number;
    stats: {
        originalSizeBytes: number;
        compressedSizeBytes: number;
        savingsPercent: string;
    };
    uploadedAt: string;
}

/**
 * Uploads and processes a question paper / document bundle into Cloudflare R2:
 * 1. Enhances text readability and compresses images (WebP/JPEG, ~80-90% smaller).
 * 2. Compiles multiple photo pages into a unified, high-quality PDF.
 * 3. Uploads all files to R2 in parallel without saturating system resources.
 * 4. Returns ready-to-use public URLs on the user's R2 domain (https://pub-752bf94badc54c60984a126ab8565981.r2.dev).
 */
export const uploadAndProcessDocument = async (
    input: DocumentUploadInput
): Promise<DocumentUploadResponse> => {
    const docId = input.docId || randomUUID();
    const timestamp = Date.now();

    // Step 1: Compress images & compile master PDF
    const bundleOptions: {
        title?: string | undefined;
        optimizeOptions?: DocumentOptimizeOptions | undefined;
    } = {
        title: input.title || `cDocs-${docId}`,
    };
    if (input.compressionOptions) {
        bundleOptions.optimizeOptions = input.compressionOptions;
    }

    const bundle = await processDocumentUploadBundle(input.files, bundleOptions);

    const uploadItems: R2BatchUploadItem[] = [];
    const storedPages: StoredDocumentPage[] = [];

    // Step 2: Queue individual page images for R2 upload
    for (const page of bundle.pages) {
        const ext = page.format === "webp" ? "webp" : "jpg";
        const pageKey = `documents/${docId}/pages/page-${page.pageIndex}-${timestamp}.${ext}`;
        uploadItems.push({
            fileBuffer: page.buffer,
            key: pageKey,
            contentType: page.contentType,
            metadata: {
                docId,
                pageNumber: String(page.pageIndex),
                userId: input.userId || "anonymous",
            },
        });

        storedPages.push({
            pageNumber: page.pageIndex,
            key: pageKey,
            publicUrl: getR2PublicUrl(pageKey),
            contentType: page.contentType,
            size: page.size,
            width: page.width,
            height: page.height,
        });
    }

    // Step 2b: Create and queue optimized thumbnail for UI preview
    let thumbnailKey: string | undefined = undefined;
    let thumbnailUrl: string | undefined = undefined;

    if (bundle.pages.length > 0 && bundle.pages[0]) {
        try {
            const thumbBuffer = await sharp(bundle.pages[0].buffer)
                .resize({ width: 240, height: 340, fit: "cover", position: "top", withoutEnlargement: true })
                .webp({ quality: 58, effort: 6 })
                .toBuffer();

            thumbnailKey = `documents/${docId}/thumbnail-${timestamp}.webp`;
            thumbnailUrl = getR2PublicUrl(thumbnailKey);

            uploadItems.push({
                fileBuffer: thumbBuffer,
                key: thumbnailKey,
                contentType: "image/webp",
                cacheControl: "public, max-age=31536000, immutable",
            });
        } catch (thumbErr) {
            console.warn("[Thumbnail Generator] Falling back to page 1 URL:", thumbErr);
            if (storedPages[0]) {
                thumbnailKey = storedPages[0].key;
                thumbnailUrl = storedPages[0].publicUrl;
            }
        }
    }

    // Step 3: Queue compiled master PDF for R2 upload (if generated or uploaded directly)
    let pdfKey: string | undefined = undefined;
    let pdfUrl: string | undefined = undefined;
    let pdfSize: number | undefined = undefined;

    if (bundle.compiledPdf) {
        pdfKey = `documents/${docId}/document-${timestamp}.pdf`;
        pdfUrl = getR2PublicUrl(pdfKey);
        pdfSize = bundle.compiledPdf.size;

        uploadItems.push({
            fileBuffer: bundle.compiledPdf.buffer,
            key: pdfKey,
            contentType: "application/pdf",
            metadata: {
                docId,
                title: input.title || "",
                userId: input.userId || "anonymous",
                subjectCode: input.subjectCode || "",
                college: input.college || "",
            },
        });
    }

    // Step 4: Perform concurrent upload to R2
    const uploadResult = await uploadBatchToR2(uploadItems, 3);
    if (uploadResult.failed.length > 0) {
        console.warn(`[Document Upload] ${uploadResult.failed.length} items failed to upload to R2`);
    }

    const response: DocumentUploadResponse = {
        docId,
        title: input.title,
        pages: storedPages,
        totalPages: storedPages.length || (bundle.compiledPdf ? 1 : 0),
        stats: {
            originalSizeBytes: bundle.totalOriginalSize,
            compressedSizeBytes: bundle.totalCompressedSize,
            savingsPercent: bundle.overallSavings,
        },
        uploadedAt: new Date().toISOString(),
    };

    if (pdfUrl !== undefined) response.pdfUrl = pdfUrl;
    if (pdfKey !== undefined) response.pdfKey = pdfKey;
    if (pdfSize !== undefined) response.pdfSize = pdfSize;
    if (thumbnailUrl !== undefined) response.thumbnailUrl = thumbnailUrl;
    if (thumbnailKey !== undefined) response.thumbnailKey = thumbnailKey;

    return response;
};

/**
 * Deletes all files associated with a document from R2
 */
export const deleteDocumentBundleFromR2 = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    await deleteBatchFromR2(keys);
};

// Re-export core functions for convenient access across modules
export {
    getR2PublicUrl,
    readFromR2Stream,
    readFromR2Buffer,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    uploadToR2,
};
