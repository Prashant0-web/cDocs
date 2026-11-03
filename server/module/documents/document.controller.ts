import type { Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import sharp from "sharp";
import DocumentModel from "./document.model.js";
import DocumentReviewModel from "./review.model.js";
import "../user/user.model.js";
import {
    validateAndExtractPageData,
    analyzeBatchDocuments,
    computeDHash128,
    computeHammingDistance,
    expandSearchQueryWithAI,
} from "../../shared/gemini.service.js";
import {
    uploadAndProcessDocument,
    getR2PublicUrl,
    getPresignedUploadUrl,
    readFromR2Stream,
} from "../../shared/document-storage.service.js";

/**
 * Extracts and validates creator userId from JWT authorization header or body
 */
const getCreatorUserId = (req: Request): mongoose.Types.ObjectId | null => {
    // 1. Check req.user if set by auth middleware
    const userFromReq = (req as any).user;
    if (userFromReq?.userId && mongoose.Types.ObjectId.isValid(userFromReq.userId)) {
        return new mongoose.Types.ObjectId(userFromReq.userId);
    }

    // 2. Check Authorization Bearer token header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
            const token = authHeader.split(" ")[1];
            const secret = process.env.JWT_SECRET as string;
            const decoded = jwt.verify(token as string, secret) as any;
            if (decoded?.userId && mongoose.Types.ObjectId.isValid(decoded.userId)) {
                return new mongoose.Types.ObjectId(decoded.userId);
            }
        } catch {
            // Token invalid or expired, continue to fallback
        }
    }

    // 3. Check req.body.userId fallback
    if (req.body.userId && mongoose.Types.ObjectId.isValid(req.body.userId)) {
        return new mongoose.Types.ObjectId(req.body.userId);
    }

    return null;
};

/**
 * Handles batch document upload (photo pages or PDF) with:
 * 1. Readability enhancement & compression
 * 2. Upload to Cloudflare R2
 * 3. Saving document metadata & page links in MongoDB with created_by userId
 */
export const uploadDocumentController = async (req: Request, res: Response): Promise<void> => {
    try {
        const creatorUserId = getCreatorUserId(req);
        if (creatorUserId) {
            const userDoc: any = await mongoose.model("User").findById(creatorUserId);
            if (userDoc?.uploadBlockedUntil && new Date() < new Date(userDoc.uploadBlockedUntil)) {
                const remainingMs = new Date(userDoc.uploadBlockedUntil).getTime() - Date.now();
                const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
                const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
                res.status(403).json({
                    success: false,
                    isBlocked: true,
                    blockedUntil: userDoc.uploadBlockedUntil,
                    message: `Upload access is blocked for 5 hours due to repeated random/spam image uploads. Please try again in ${remainingHours > 1 ? remainingHours + " hours" : remainingMinutes + " minutes"}.`,
                });
                return;
            }
        }

        const rawFiles = req.files as Express.Multer.File[] | undefined;
        if (!rawFiles || rawFiles.length === 0) {
            res.status(400).json({
                success: false,
                message: "No document files provided. Please attach at least 1 image or PDF.",
            });
            return;
        }

        // File Size Limit Enforcement: Max whole size 3 MB for PDFs
        for (let i = 0; i < rawFiles.length; i++) {
            const f = rawFiles[i];
            if (!f) continue;
            if (f.mimetype === "application/pdf" && f.buffer.length > 3 * 1024 * 1024) {
                const mb = (f.buffer.length / (1024 * 1024)).toFixed(2);
                res.status(400).json({
                    success: false,
                    message: `PDF file size (${mb} MB) exceeds the 3 MB maximum limit. Please upload a PDF of 3 MB or less.`,
                });
                return;
            }
        }

        // Anti-Duplicate Validation: Prevent identical image contents in the same batch
        const seenHashes = new Set<string>();
        const dHashList: { pageIndex: number; name: string; hash: string }[] = [];

        for (let i = 0; i < rawFiles.length; i++) {
            const file = rawFiles[i];
            if (!file) continue;

            // Level 1: Cryptographic SHA-256 byte hash (catches identical files/copies)
            const contentHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
            if (seenHashes.has(contentHash)) {
                res.status(400).json({
                    success: false,
                    message: `Duplicate image detected on page ${i + 1} (${file.originalname || "image"}). You cannot add the exact same image content multiple times in a question paper batch.`,
                });
                return;
            }
            seenHashes.add(contentHash);

            // Level 2: Perceptual 128-bit dHash check (catches camera shots of the same page clicked twice)
            if (file.mimetype.startsWith("image/")) {
                const dHash = await computeDHash128(file.buffer);
                if (dHash) {
                    for (const prev of dHashList) {
                        const dist = computeHammingDistance(prev.hash, dHash);
                        // dist <= 24 out of 128 bits means > 81% identical visual layout
                        if (dist <= 24) {
                            res.status(400).json({
                                success: false,
                                message: `Duplicate image detected between page ${prev.pageIndex + 1} and page ${i + 1}. Both photos show the exact same paper page. Each page in the batch must be unique.`,
                            });
                            return;
                        }
                    }
                    dHashList.push({ pageIndex: i, name: file.originalname, hash: dHash });
                }
            }
        }

        // Level 3: Check if exact same question paper has already been uploaded previously
        const firstFile = rawFiles[0];
        if (!firstFile) {
            res.status(400).json({ success: false, message: "Missing upload file." });
            return;
        }
        const firstFileHash = crypto.createHash("sha256").update(firstFile.buffer).digest("hex");
        const existingPaper = await DocumentModel.findOne({ contentHash: firstFileHash });
        if (existingPaper) {
            res.status(409).json({
                success: false,
                message: `This question paper has already been uploaded previously as "${existingPaper.title}". You cannot upload duplicate papers.`,
            });
            return;
        }

        const {
            title,
            subject,
            subjectCode,
            college,
            course,
            semester,
            examYear,
            examType,
            topCode,
            paperCode,
            tags: rawTags,
            grayscale,
        } = req.body;

        const creatorId = getCreatorUserId(req);

        // Compile searchable tags array
        const tagSet = new Set<string>();
        if (topCode) tagSet.add(String(topCode).trim());
        if (paperCode) tagSet.add(String(paperCode).trim());
        if (subjectCode) tagSet.add(String(subjectCode).trim());
        if (subject) tagSet.add(String(subject).trim());
        if (course) tagSet.add(String(course).trim());
        if (examYear) tagSet.add(String(examYear).trim());

        if (rawTags) {
            const parsedTags = Array.isArray(rawTags)
                ? rawTags
                : typeof rawTags === "string"
                ? rawTags.split(",").map((s) => s.trim())
                : [];
            parsedTags.forEach((t) => t && tagSet.add(String(t).trim()));
        }

        const tags = Array.from(tagSet).filter(Boolean);

        const files = rawFiles.map((f) => ({
            buffer: f.buffer,
            mimetype: f.mimetype,
            originalname: f.originalname,
        }));

        // 1. Process and upload to Cloudflare R2
        const r2Result = await uploadAndProcessDocument({
            files,
            title: title || rawFiles[0]?.originalname || "Exam Paper",
            userId: creatorId ? creatorId.toString() : "anonymous",
            subjectCode: subjectCode || paperCode,
            college,
            examYear,
            compressionOptions: {
                maxWidth: 1600,
                quality: 72,
                enhanceContrast: true,
                sharpenText: true,
                grayscale: grayscale === "true" || grayscale === true,
            },
        });

        // 2. Save document record in MongoDB with created_by reference
        const docRecord = new DocumentModel({
            title: title || rawFiles[0]?.originalname || "Exam Paper",
            subject,
            subjectCode: subjectCode || paperCode,
            college,
            course,
            semester,
            examYear,
            examType: examType || "end-sem",
            topCode: topCode ? String(topCode).trim() : undefined,
            paperCode: paperCode ? String(paperCode).trim() : undefined,
            tags,
            contentHash: firstFileHash,
            pdfUrl: r2Result.pdfUrl,
            pdfKey: r2Result.pdfKey,
            pdfSize: r2Result.pdfSize,
            thumbnailUrl: r2Result.thumbnailUrl,
            thumbnailKey: r2Result.thumbnailKey,
            pages: r2Result.pages.map((p) => ({
                pageNumber: p.pageNumber,
                key: p.key,
                url: p.publicUrl,
                contentType: p.contentType,
                size: p.size,
                width: p.width,
                height: p.height,
            })),
            totalPages: r2Result.totalPages,
            stats: r2Result.stats,
            created_by: creatorId,
            status: "active",
        });

        await docRecord.save();

        // Reset abuse strike counter upon successful valid question paper upload
        if (creatorId) {
            await mongoose.model("User").findByIdAndUpdate(creatorId, {
                uploadStrikes: 0,
                uploadBlockedUntil: null,
            });
            await docRecord.populate("created_by", "username email");
        }

        const docObj = docRecord.toObject ? docRecord.toObject() : docRecord;
        const { pdfUrl: _pUrl, pdfKey: _pKey, pages: _docPages, ...safeDoc } = docObj;

        res.status(201).json({
            success: true,
            message: "Document uploaded to Cloudflare R2 and saved to database successfully",
            data: {
                ...safeDoc,
                thumbnailUrl: docRecord.thumbnailUrl || null,
                totalPages: docRecord.totalPages,
                stats: docRecord.stats,
            },
        });
    } catch (error: any) {
        console.error("[Upload Document Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to process and upload document",
        });
    }
};

/**
 * Searches and lists documents from MongoDB
 */
/**
 * Searches and lists documents from MongoDB.
 * When search query is provided, performs multi-factor relevance scoring
 * across Codes (topCode, paperCode), AI-generated tags, Semester, Subject, and Title,
 * ranking the best matching document at the very top.
 */
export const getDocumentsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { search, college, subjectCode, examYear, semester, page = "1", limit = "20", sortBy } = req.query;

        const filter: Record<string, any> = { status: "active" };

        if (college) {
            filter.college = new RegExp(String(college), "i");
        }
        if (subjectCode) {
            filter.subjectCode = new RegExp(String(subjectCode), "i");
        }
        if (examYear) {
            filter.examYear = String(examYear);
        }
        if (semester) {
            filter.semester = new RegExp(String(semester), "i");
        }

        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const searchStr = String(search || "").trim();

        // 1. If no search query, return standard chronological listing or sorted by views
        if (!searchStr) {
            const sortOption: any = sortBy === "views" ? { views: -1, createdAt: -1 } : { createdAt: -1 };

            const [documents, total] = await Promise.all([
                DocumentModel.find(filter)
                    .sort(sortOption)
                    .skip(skip)
                    .limit(limitNum)
                    .populate("created_by", "username email")
                    .lean(),
                DocumentModel.countDocuments(filter),
            ]);

            const sanitizedDocs = documents.map((doc: any) => {
                const { pdfUrl, pdfKey, pages: docPages, ...rest } = doc;
                return {
                    ...rest,
                    thumbnailUrl: doc.thumbnailUrl || null,
                    pages: (docPages || []).map((p: any) => ({
                        pageNumber: p.pageNumber,
                        size: p.size,
                    })),
                };
            });

            res.status(200).json({
                success: true,
                data: {
                    documents: sanitizedDocs,
                    pagination: {
                        total,
                        page: pageNum,
                        limit: limitNum,
                        totalPages: Math.ceil(total / limitNum),
                    },
                },
            });
            return;
        }

        // =========================================================================
        // 2. INTELLIGENT RELEVANCE MATCH SCORING & RANKING
        // =========================================================================
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const lowerQuery = searchStr.toLowerCase();
        const rawTokens = searchStr
            .split(/[\s,+#-]+/)
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0);

        const fullRegex = new RegExp(escapeRegex(searchStr), "i");
        const tokenRegexes = rawTokens.map((t) => new RegExp(escapeRegex(t), "i"));

        // Match candidates across primary, secondary, and AI tag fields
        const candidateOrConditions: any[] = [
            { title: fullRegex },
            { subject: fullRegex },
            { subjectCode: fullRegex },
            { topCode: fullRegex },
            { paperCode: fullRegex },
            { semester: fullRegex },
            { college: fullRegex },
            { course: fullRegex },
            { tags: fullRegex },
            { examYear: fullRegex },
        ];

        for (const tr of tokenRegexes) {
            candidateOrConditions.push(
                { topCode: tr },
                { paperCode: tr },
                { subjectCode: tr },
                { subject: tr },
                { semester: tr },
                { tags: tr },
                { title: tr },
                { college: tr },
                { examYear: tr }
            );
        }

        const candidateFilter = {
            ...filter,
            $or: candidateOrConditions,
        };

        const candidateDocs = await DocumentModel.find(candidateFilter)
            .limit(200)
            .populate("created_by", "username email")
            .lean();

        // Score each candidate document based on match relevance
        const scoredDocs = candidateDocs.map((doc: any) => {
            let score = 0;
            const matchReasons: string[] = [];
            const matchedTokensSet = new Set<string>();

            const pCode = (doc.paperCode || "").toLowerCase().trim();
            const tCode = (doc.topCode || "").toLowerCase().trim();
            const dTitle = (doc.title || "").toLowerCase().trim();
            const dSubj = (doc.subject || doc.subjectCode || "").toLowerCase().trim();
            const dSem = (doc.semester || "").toLowerCase().trim();
            const dYear = String(doc.examYear || "").toLowerCase().trim();
            const dCollege = (doc.college || doc.course || "").toLowerCase().trim();
            const dTags: string[] = Array.isArray(doc.tags)
                ? doc.tags.map((t: string) => String(t).toLowerCase().trim())
                : [];

            // (A) EXACT / DIRECT CODE MATCHES (Highest Priority in Exam Searches)
            if (pCode) {
                if (pCode === lowerQuery) {
                    score += 260;
                    matchReasons.push("Exact Paper Code Match");
                } else if (pCode.includes(lowerQuery) || lowerQuery.includes(pCode)) {
                    score += 130;
                    matchReasons.push("Paper Code Partial Match");
                }
            }

            if (tCode) {
                if (tCode === lowerQuery) {
                    score += 230;
                    matchReasons.push("Exact Top Code Match");
                } else if (tCode.includes(lowerQuery) || lowerQuery.includes(tCode)) {
                    score += 110;
                    matchReasons.push("Top Code Partial Match");
                }
            }

            // (B) FULL QUERY MATCHES IN TITLE, SUBJECT, SEMESTER
            if (dTitle === lowerQuery) {
                score += 180;
                matchReasons.push("Exact Title Match");
            } else if (dTitle.includes(lowerQuery)) {
                score += 85;
                matchReasons.push("Title Match");
            }

            if (dSubj === lowerQuery) {
                score += 160;
                matchReasons.push("Exact Subject Match");
            } else if (dSubj.includes(lowerQuery)) {
                score += 75;
                matchReasons.push("Subject Match");
            }

            if (dSem && (dSem === lowerQuery || lowerQuery.includes(dSem))) {
                score += 90;
                matchReasons.push("Semester Match");
            }

            // (C) AI-GENERATED TAGS MATCHING (Crucial: Matches search against AI extracted tags)
            if (dTags.length > 0) {
                if (dTags.includes(lowerQuery)) {
                    score += 140;
                    matchReasons.push("Exact AI Tag Match");
                } else if (dTags.some((t) => t.includes(lowerQuery) || lowerQuery.includes(t))) {
                    score += 65;
                    matchReasons.push("AI Tag Match");
                }
            }

            // (D) MULTI-TOKEN KEYWORD MATCHES (e.g. "calculus 2024 sem 4")
            for (const token of rawTokens) {
                let tokenMatched = false;

                if (pCode && pCode.includes(token)) {
                    score += 80;
                    tokenMatched = true;
                }
                if (tCode && tCode.includes(token)) {
                    score += 75;
                    tokenMatched = true;
                }
                if (dTags.some((t) => t.includes(token))) {
                    score += 50; // AI Tag match
                    tokenMatched = true;
                }
                if (dSubj.includes(token)) {
                    score += 40;
                    tokenMatched = true;
                }
                if (dTitle.includes(token)) {
                    score += 35;
                    tokenMatched = true;
                }
                if (dSem.includes(token)) {
                    score += 45;
                    tokenMatched = true;
                }
                if (dYear.includes(token)) {
                    score += 35;
                    tokenMatched = true;
                }
                if (dCollege.includes(token)) {
                    score += 20;
                    tokenMatched = true;
                }

                if (tokenMatched) {
                    matchedTokensSet.add(token);
                }
            }

            // (E) COMPLETENESS BONUS: When document matches ALL user query words
            if (rawTokens.length > 1 && matchedTokensSet.size === rawTokens.length) {
                score += 130;
                matchReasons.push("100% Query Terms Matched");
            } else if (rawTokens.length > 1 && matchedTokensSet.size > 0) {
                score += Math.round((matchedTokensSet.size / rawTokens.length) * 50);
            }

            // (F) POPULARITY MICRO-BOOST (Views/reads)
            score += Math.min(10, (doc.views || 0) * 0.2);

            const { pdfUrl, pdfKey, pages: docPages, ...rest } = doc;
            return {
                ...rest,
                matchScore: score,
                matchingReasons: Array.from(new Set(matchReasons)),
                thumbnailUrl: doc.thumbnailUrl || null,
                pages: (docPages || []).map((p: any) => ({
                    pageNumber: p.pageNumber,
                    size: p.size,
                })),
            };
        });

        // SORT DESCENDING: Highest match score is guaranteed at index 0 (top of results)
        scoredDocs.sort((a, b) => {
            if (b.matchScore !== a.matchScore) {
                return b.matchScore - a.matchScore;
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        // Mark the highest ranking doc as Top Match if score is solid
        if (scoredDocs.length > 0 && (scoredDocs[0]?.matchScore ?? 0) >= 40) {
            (scoredDocs[0] as any).isTopMatch = true;
        }

        const total = scoredDocs.length;
        const paginatedDocs = scoredDocs.slice(skip, skip + limitNum);

        res.status(200).json({
            success: true,
            data: {
                documents: paginatedDocs,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum),
                },
                queryDetails: {
                    search: searchStr,
                    topMatchScore: scoredDocs[0]?.matchScore || 0,
                    topMatchReasons: scoredDocs[0]?.matchingReasons || [],
                },
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve documents",
        });
    }
};

/**
 * Gets a single document by ID and increments view count
 */
export const getDocumentByIdController = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            res.status(400).json({ success: false, message: "Invalid document ID" });
            return;
        }

        const doc: any = await DocumentModel.findByIdAndUpdate(
            id,
            { $inc: { views: 1 } },
            { new: true }
        )
            .populate("created_by", "username email")
            .lean();

        if (!doc) {
            res.status(404).json({ success: false, message: "Document not found" });
            return;
        }

        const { pdfUrl, pdfKey, pages: docPages, ...rest } = doc;
        const sanitized = {
            ...rest,
            thumbnailUrl: doc.thumbnailUrl || null,
            pages: (docPages || []).map((p: any) => ({
                pageNumber: p.pageNumber,
                size: p.size,
            })),
        };

        res.status(200).json({ success: true, data: sanitized });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to fetch document",
        });
    }
};

/**
 * Returns a presigned upload URL for direct-to-R2 client upload (Zero Server Load)
 */
export const getPresignedUrlController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key, contentType } = req.body;
        if (!key || !contentType) {
            res.status(400).json({
                success: false,
                message: "Both 'key' and 'contentType' are required",
            });
            return;
        }

        const presigned = await getPresignedUploadUrl(key, contentType, 900);
        res.status(200).json({
            success: true,
            data: presigned,
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to generate presigned upload URL",
        });
    }
};

/**
 * SECURE IN-APP PDF STREAMING
 * Streams the document directly from Cloudflare R2 into client memory without ever exposing R2 URLs.
 * Sets strict DRM HTTP headers: inline viewing only, no caching, nosniff.
 */
export const secureViewDocumentController = async (req: Request, res: Response): Promise<void> => {
    try {
        // 1. Authenticate user before allowing secure document access
        const authHeader = req.headers.authorization;
        let token: string | undefined;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        } else if (typeof req.query.token === "string" && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            res.status(401).json({
                success: false,
                message: "Unauthorized: You must be logged in to view protected documents.",
            });
            return;
        }

        try {
            const secret = (process.env.JWT_SECRET as string) || "your-default-secret";
            jwt.verify(token, secret);
        } catch (jwtErr) {
            res.status(403).json({
                success: false,
                message: "Session expired or invalid token. Please sign in again.",
            });
            return;
        }

        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            res.status(400).json({ success: false, message: "Invalid document ID" });
            return;
        }

        const doc = await DocumentModel.findById(id);
        if (!doc) {
            res.status(404).json({ success: false, message: "Document not found" });
            return;
        }

        // Increment view count
        doc.views = (doc.views || 0) + 1;
        await doc.save();

        let stream: any;
        let contentType = "application/pdf";

        if (doc.pdfKey) {
            stream = await readFromR2Stream(doc.pdfKey);
            contentType = "application/pdf";
        } else if (doc.pages && doc.pages.length > 0 && doc.pages[0]?.key) {
            stream = await readFromR2Stream(doc.pages[0].key);
            contentType = doc.pages[0].contentType || "image/webp";
        } else {
            res.status(404).json({ success: false, message: "No document binary found in storage" });
            return;
        }

        // Strict DRM & anti-download HTTP headers
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", 'inline; filename="secure-view.pdf"');
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("X-Content-Type-Options", "nosniff");

        stream.pipe(res);
    } catch (error: any) {
        console.error("[Secure View Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to securely stream document",
        });
    }
};

/**
 * Streams a document directly from R2 using internal key
 */
export const streamDocumentController = async (req: Request, res: Response): Promise<void> => {
    try {
        const keyParam = req.params.key || req.query.key;
        const key = Array.isArray(keyParam) ? keyParam.join("/") : String(keyParam || "");
        if (!key) {
            res.status(400).json({ success: false, message: "Document key is required" });
            return;
        }

        const stream = await readFromR2Stream(key);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.setHeader("X-Content-Type-Options", "nosniff");
        stream.pipe(res);
    } catch (error: any) {
        res.status(404).json({
            success: false,
            message: error.message || "Document not found in R2",
        });
    }
};

/**
 * Validates whether an uploaded page is the front page of a question paper
 * using Gemini Vision AI and extracts topCode, paperCode, subject, and tags.
 */
export const validatePageController = async (req: Request, res: Response): Promise<void> => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({
                success: false,
                message: "No image file provided for validation",
            });
            return;
        }

        const result = await validateAndExtractPageData(file.buffer, file.mimetype);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error: any) {
        console.error("[Validate Page Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to validate page image",
        });
    }
};

/**
 * Fast search suggestions endpoint for autocomplete dropdown (matching topCode, paperCode, subject, semester, tags)
 */
export const getSearchSuggestionsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const query = String(req.query.q || req.query.query || "").trim();
        if (!query || query.length < 2) {
            res.status(200).json({ success: true, data: [] });
            return;
        }

        const regex = new RegExp(query, "i");

        const matches = await DocumentModel.find({
            status: "active",
            $or: [
                { topCode: regex },
                { paperCode: regex },
                { subjectCode: regex },
                { subject: regex },
                { semester: regex },
                { tags: regex },
                { title: regex },
            ],
        })
            .select("title subject topCode paperCode subjectCode semester tags course examYear")
            .limit(15)
            .lean();

        // Extract clean unique suggestion chips / items with priority
        const suggestionsMap = new Map<string, { type: string; value: string; label: string }>();

        // 1. Codes first
        for (const doc of matches) {
            if (doc.topCode && regex.test(doc.topCode)) {
                suggestionsMap.set(`topCode:${doc.topCode}`, {
                    type: "topCode",
                    value: doc.topCode,
                    label: `Code: ${doc.topCode} (${doc.title})`,
                });
            }
            if (doc.paperCode && regex.test(doc.paperCode)) {
                suggestionsMap.set(`paperCode:${doc.paperCode}`, {
                    type: "paperCode",
                    value: doc.paperCode,
                    label: `Paper Code: ${doc.paperCode} (${doc.subject || doc.title})`,
                });
            }
        }

        // 2. AI Tags
        for (const doc of matches) {
            if (Array.isArray(doc.tags)) {
                for (const tag of doc.tags) {
                    if (regex.test(tag) && !suggestionsMap.has(`tag:${tag}`)) {
                        suggestionsMap.set(`tag:${tag}`, {
                            type: "tag",
                            value: tag,
                            label: `#${tag}`,
                        });
                    }
                }
            }
        }

        // 3. Subjects & Semesters
        for (const doc of matches) {
            if (doc.subject && regex.test(doc.subject) && !suggestionsMap.has(`subject:${doc.subject}`)) {
                suggestionsMap.set(`subject:${doc.subject}`, {
                    type: "subject",
                    value: doc.subject,
                    label: `${doc.subject} • ${doc.course || ""}`,
                });
            }
            if (doc.semester && regex.test(doc.semester) && !suggestionsMap.has(`semester:${doc.semester}`)) {
                suggestionsMap.set(`semester:${doc.semester}`, {
                    type: "semester",
                    value: doc.semester,
                    label: `Semester: ${doc.semester}`,
                });
            }
        }

        res.status(200).json({
            success: true,
            data: Array.from(suggestionsMap.values()).slice(0, 8),
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Dynamic AI Search Query Expansion:
 * Expands student queries into AI tags and related keywords
 */
export const expandSearchQueryController = async (req: Request, res: Response): Promise<void> => {
    try {
        const query = String(req.query.q || req.query.query || "").trim();
        if (!query || query.length < 2) {
            res.status(200).json({ success: true, data: { tags: [] } });
            return;
        }

        const tags = await expandSearchQueryWithAI(query);
        res.status(200).json({
            success: true,
            data: { tags },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Multi-page batch analysis endpoint:
 * Analyzes all captured pages together to auto-fill Title, Subject, Semester, Year, Codes, and check for duplicates
 */
export const analyzeBatchPagesController = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = getCreatorUserId(req);
        if (userId) {
            const userDoc: any = await mongoose.model("User").findById(userId);
            if (userDoc?.uploadBlockedUntil && new Date() < new Date(userDoc.uploadBlockedUntil)) {
                const remainingMs = new Date(userDoc.uploadBlockedUntil).getTime() - Date.now();
                const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
                const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
                res.status(403).json({
                    success: false,
                    isBlocked: true,
                    blockedUntil: userDoc.uploadBlockedUntil,
                    message: `Upload access is blocked for 5 hours due to repeated random/spam image uploads. Please try again in ${remainingHours > 1 ? remainingHours + " hours" : remainingMinutes + " minutes"}.`,
                });
                return;
            }
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
            res.status(400).json({
                success: false,
                message: "No pages provided for analysis.",
            });
            return;
        }

        const result = await analyzeBatchDocuments(files);

        // If random / non-academic images were detected, increment user's strike
        if (result.hasNonAcademicPages && userId) {
            const userDoc: any = await mongoose.model("User").findById(userId);
            if (userDoc) {
                const currentStrikes = (userDoc.uploadStrikes || 0) + 1;
                if (currentStrikes >= 3) {
                    const blockedUntil = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours lockout!
                    userDoc.uploadBlockedUntil = blockedUntil;
                    userDoc.uploadStrikes = 3;
                    await userDoc.save();

                    res.status(403).json({
                        success: false,
                        isBlocked: true,
                        strikes: 3,
                        blockedUntil,
                        data: {
                            ...result,
                            strikes: 3,
                            isBlocked: true,
                            blockedUntil,
                        },
                        message: "3rd attempt with random/non-academic image detected! You have been blocked from uploading question papers for 5 hours.",
                    });
                    return;
                } else {
                    userDoc.uploadStrikes = currentStrikes;
                    await userDoc.save();
                    (result as any).strikes = currentStrikes;
                    (result as any).strikesRemaining = 3 - currentStrikes;
                }
            }
        }

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error: any) {
        console.error("[Analyze Batch Pages Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to analyze paper pages",
        });
    }
};

/**
 * @route POST /documents/:id/reviews
 * Creates a review/feedback on a document
 */
export const createDocumentReviewController = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            res.status(400).json({ success: false, message: "Invalid document ID" });
            return;
        }

        const doc = await DocumentModel.findById(id).select("_id title").lean();
        if (!doc) {
            res.status(404).json({ success: false, message: "Document not found" });
            return;
        }

        const { stars, feedback, username, tags } = req.body;
        const numStars = Number(stars);
        if (isNaN(numStars) || numStars < 1 || numStars > 5) {
            res.status(400).json({ success: false, message: "Stars rating must be between 1 and 5" });
            return;
        }

        if (!feedback || typeof feedback !== "string" || !feedback.trim()) {
            res.status(400).json({ success: false, message: "Feedback message cannot be empty" });
            return;
        }

        const userId = getCreatorUserId(req);
        let finalUsername = typeof username === "string" && username.trim() ? username.trim() : "Anonymous Student";

        if (userId) {
            const userDoc: any = await mongoose.model("User").findById(userId).select("username").lean();
            if (userDoc?.username) {
                finalUsername = userDoc.username;
            }
        }

        const newReview = await DocumentReviewModel.create({
            documentId: new mongoose.Types.ObjectId(id),
            created_by: userId,
            username: finalUsername,
            stars: Math.round(numStars),
            feedback: feedback.trim().slice(0, 1000),
            tags: Array.isArray(tags) ? tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
        });

        res.status(201).json({
            success: true,
            message: "Feedback submitted successfully!",
            data: newReview,
        });
    } catch (error: any) {
        console.error("[Create Document Review Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to submit review",
        });
    }
};

/**
 * @route GET /documents/:id/reviews
 * Fetches reviews and rating distribution for a document
 */
export const getDocumentReviewsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            res.status(400).json({ success: false, message: "Invalid document ID" });
            return;
        }

        const reviews = await DocumentReviewModel.find({
            documentId: new mongoose.Types.ObjectId(id),
        })
            .populate("created_by", "username email")
            .sort({ createdAt: -1 })
            .lean();

        const totalReviews = reviews.length;
        let sum = 0;
        const breakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

        for (const r of reviews) {
            sum += r.stars;
            const s = Number(r.stars);
            if (s >= 1 && s <= 5) {
                breakdown[s] = (breakdown[s] ?? 0) + 1;
            }
        }

        const averageStars = totalReviews > 0 ? Number((sum / totalReviews).toFixed(1)) : 5.0;

        res.status(200).json({
            success: true,
            data: {
                reviews,
                totalReviews,
                averageStars,
                breakdown,
            },
        });
    } catch (error: any) {
        console.error("[Get Document Reviews Controller Error]:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to fetch document reviews",
        });
    }
};
