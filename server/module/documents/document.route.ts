import { Router } from "express";
import multer from "multer";
import {
    uploadDocumentController,
    getDocumentsController,
    getDocumentByIdController,
    secureViewDocumentController,
    getPresignedUrlController,
    streamDocumentController,
    validatePageController,
    getSearchSuggestionsController,
    analyzeBatchPagesController,
    expandSearchQueryController,
} from "./document.controller.js";

const router = Router();

// Configure Multer with strict safeguards to prevent memory exhaustion & DoS
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // Max 25MB per file
        files: 10, // Max 10 page images per question paper batch
    },
    fileFilter: (_req, file, cb) => {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
            "application/pdf",
        ];

        if (allowedTypes.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    `Invalid file type: ${file.mimetype}. Only PDFs and images (JPEG, PNG, WebP) are allowed.`
                )
            );
        }
    },
});

/**
 * @route GET /documents/suggestions
 * Returns live autocomplete suggestions for topCode, paperCode, subject, and tags
 */
router.get("/suggestions", getSearchSuggestionsController);

/**
 * @route GET /documents/expand-query
 * Uses AI to expand search query into relevant tags & keywords
 */
router.get("/expand-query", expandSearchQueryController);

/**
 * @route POST /documents/validate-page
 * AI-powered front page validation & code extraction using Google Gemini Vision
 */
router.post("/validate-page", upload.single("file"), validatePageController);

/**
 * @route POST /documents/analyze-batch
 * Multi-page AI analysis: checks for duplicate pages, extracts Title, Subject, Semester, Year, and auto-fills fields
 */
router.post("/analyze-batch", upload.array("files", 10), analyzeBatchPagesController);

/**
 * @route GET /documents
 * Searches and lists documents from database with pagination and filters
 */
router.get("/", getDocumentsController);

/**
 * @route GET /documents/view/:id
 * SECURE IN-APP DRM VIEWING: Streams document binary without exposing R2 URL
 */
router.get("/view/:id", secureViewDocumentController);

/**
 * @route GET /documents/:id
 * Fetches a single document metadata by ID
 */
router.get("/:id", getDocumentByIdController);

/**
 * @route POST /documents/upload
 * Accepts multipart/form-data with field name "files" (1 to 10 files)
 * Compresses images, compiles PDF, uploads to Cloudflare R2, and saves to MongoDB with created_by
 */
router.post("/upload", upload.array("files", 10), uploadDocumentController);

/**
 * @route POST /documents/presigned-url
 * Generates presigned URL for direct client-to-R2 upload (zero backend CPU/RAM usage)
 */
router.post("/presigned-url", getPresignedUrlController);

/**
 * @route GET /documents/stream / /documents/stream/*key
 * Compatible with Express 5 / path-to-regexp v8 wildcard format
 */
router.get("/stream/*key", streamDocumentController);
router.get("/stream", streamDocumentController);

export default router;
