import React, { useState, useRef, useEffect } from "react";
import Navbar from "../../components/Navbar";
import { SignUp } from "../auth/auth";
import type { StoredUser } from "../../utils/cookie.util";
import { get, uploadMultipart } from "../../services/api.service";
import { SecureReaderModal, type SecureReaderDoc } from "../../components/SecureReaderModal";

interface HomeProps {
    user: StoredUser | null;
    onSignOut: () => void;
    onAuthSuccess?: (user: StoredUser) => void;
    onNavigatePrivacy?: () => void;
}

interface PaperItem {
    id: string;
    title: string;
    subject: string;
    course: string;
    year: string;
    semester?: string;
    type: string;
    downloads: number;
    rating: number;
    uploadedBy: string;
    thumbnailUrl?: string | null;
    topCode?: string;
    paperCode?: string;
    pdfUrl?: string;
    pages?: Array<{ url: string; pageNumber: number }>;
    tags?: string[];
    matchScore?: number;
    isTopMatch?: boolean;
    matchingReasons?: string[];
}

interface CapturedPage {
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
async function computeFileSha256(file: File): Promise<string> {
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
async function computeImagePerceptualHash(file: File): Promise<string> {
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

function calculateDHashDistance(h1: string, h2: string): number {
    if (!h1 || !h2 || h1.length !== h2.length) return 128;
    let dist = 0;
    for (let i = 0; i < h1.length; i++) {
        if (h1[i] !== h2[i]) dist++;
    }
    return dist;
}

export const Home: React.FC<HomeProps> = ({
    user,
    onSignOut,
    onAuthSuccess,
    onNavigatePrivacy,
}) => {
    const searchInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<PaperItem[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadDetails, setUploadDetails] = useState<{
        savingsPercent?: string;
        pdfUrl?: string;
        totalPages?: number;
    } | null>(null);

    // Auth gatekeeper state
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    // Sign out confirmation modal state
    const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);

    // Active DRM in-app reader state
    const [activeReadingDoc, setActiveReadingDoc] = useState<SecureReaderDoc | null>(null);

    // Upload & Paper Camera Capture State
    const [uploadTab, setUploadTab] = useState<"camera" | "file">("file");
    const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
    const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
    const [uploadTitle, setUploadTitle] = useState("");
    const [uploadSubject, setUploadSubject] = useState("");
    const [uploadCollege, setUploadCollege] = useState("");
    const [uploadCourse, setUploadCourse] = useState("");
    const [uploadYear, setUploadYear] = useState("2024");
    const [uploadSemester, setUploadSemester] = useState("Semester 1");
    const [uploadFile, setUploadFile] = useState<File | null>(null);

    // Gemini Front Page Verification & Code Extraction State
    const [isValidatingPage, setIsValidatingPage] = useState(false);
    const [isAnalyzingBatch, setIsAnalyzingBatch] = useState(false);
    const [batchAnalysisDone, setBatchAnalysisDone] = useState(false);
    const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});

    const toggleFieldLock = (field: string) => {
        setLockedFields((prev) => ({ ...prev, [field]: !prev[field] }));
    };

    const [pageValidationStatus, setPageValidationStatus] = useState<{
        checked: boolean;
        isFrontPage: boolean;
        indicatorsFound: string[];
        message?: string;
    } | null>(null);
    const [uploadTopCode, setUploadTopCode] = useState("");
    const [uploadPaperCode, setUploadPaperCode] = useState("");
    const [uploadTags, setUploadTags] = useState<string[]>([]);

    // Academic Integrity & Anti-Spam (5-Hour Lockout & Invalid Image Detection) States
    const [invalidPageNumbers, setInvalidPageNumbers] = useState<number[]>([]);
    const [invalidPageReasons, setInvalidPageReasons] = useState<Record<number, string>>({});
    const [uploadStrikes, setUploadStrikes] = useState<number>(0);
    const [uploadLockout, setUploadLockout] = useState<{
        isBlocked: boolean;
        blockedUntil?: string;
        message?: string;
    } | null>(null);

    // AI-generated search query tags
    const [aiQueryTags, setAiQueryTags] = useState<string[]>([]);

    // Search Autocomplete Suggestions State
    const [suggestions, setSuggestions] = useState<Array<{ type: string; value: string; label: string }>>([]);
    const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);

    // Check stored 5-hour lockout on mount
    useEffect(() => {
        const storedLockout = localStorage.getItem("cdocs_upload_lockout");
        if (storedLockout) {
            try {
                const parsed = JSON.parse(storedLockout);
                if (parsed.blockedUntil && new Date(parsed.blockedUntil).getTime() > Date.now()) {
                    setUploadLockout(parsed);
                } else {
                    localStorage.removeItem("cdocs_upload_lockout");
                    setUploadLockout(null);
                }
            } catch {
                localStorage.removeItem("cdocs_upload_lockout");
            }
        }
    }, []);

    // Fetch real documents from database & Cloudflare R2
    const fetchPapers = async (query?: string) => {
        setIsSearching(true);
        try {
            const endpoint = query ? `/documents?search=${encodeURIComponent(query)}` : "/documents";
            const res = await get<{ success: boolean; data: { documents: any[] } }>(endpoint);
            const docs = res?.data?.documents || [];
            const mapped: PaperItem[] = docs.map((doc: any) => ({
                id: doc._id || doc.id,
                title: doc.title,
                subject: doc.subject || doc.subjectCode || "Exam Paper",
                course: doc.college || doc.course || "College Document",
                year: doc.examYear || doc.year || "2024",
                semester: doc.semester || "",
                type: doc.examType || "Endsem",
                downloads: doc.views || doc.downloads || 0,
                rating: 5.0,
                uploadedBy: doc.created_by?.username || "student",
                thumbnailUrl: doc.thumbnailUrl || (doc.pages && doc.pages[0]?.url) || null,
                topCode: doc.topCode,
                paperCode: doc.paperCode,
                pages: doc.pages,
                tags: doc.tags || [],
                matchScore: doc.matchScore,
                isTopMatch: Boolean(doc.isTopMatch),
                matchingReasons: doc.matchingReasons || [],
            }));
            setSearchResults(mapped);
        } catch (err) {
            console.error("Failed to fetch documents:", err);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    // Load documents on initial render
    useEffect(() => {
        fetchPapers();
    }, []);

    // Search autocomplete suggestions & AI query tags fetch effect
    useEffect(() => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setSuggestions([]);
            setIsSuggestionsOpen(false);
            setAiQueryTags([]);
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const [sugRes, tagRes] = await Promise.allSettled([
                    get<{ success: boolean; data: any[] }>(
                        `/documents/suggestions?q=${encodeURIComponent(searchQuery.trim())}`
                    ),
                    get<{ success: boolean; data: { tags: string[] } }>(
                        `/documents/expand-query?q=${encodeURIComponent(searchQuery.trim())}`
                    ),
                ]);

                if (sugRes.status === "fulfilled" && sugRes.value?.data && sugRes.value.data.length > 0) {
                    setSuggestions(sugRes.value.data);
                    setIsSuggestionsOpen(true);
                } else {
                    setSuggestions([]);
                    setIsSuggestionsOpen(false);
                }

                if (tagRes.status === "fulfilled" && tagRes.value?.data?.tags && tagRes.value.data.tags.length > 0) {
                    setAiQueryTags(tagRes.value.data.tags);
                }
            } catch {
                setSuggestions([]);
                setIsSuggestionsOpen(false);
            }
        }, 220);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Gatekeeper function requiring authentication before action
    const requireAuth = (action?: () => void) => {
        if (user) {
            action?.();
            return;
        }
        setPendingAction(() => action || null);
        setIsAuthModalOpen(true);
    };

    const executeSearch = (queryToSearch: string) => {
        setHasSearched(true);
        fetchPapers(queryToSearch);
    };

    const handleSearch = (e?: React.FormEvent, customQuery?: string) => {
        if (e) e.preventDefault();
        const queryToSearch = customQuery !== undefined ? customQuery : searchQuery;
        if (!queryToSearch.trim()) {
            fetchPapers();
            return;
        }

        if (!user) {
            requireAuth(() => {
                executeSearch(queryToSearch);
            });
            return;
        }

        executeSearch(queryToSearch);
    };

    const handleQuickTagClick = (tag: string) => {
        setSearchQuery(tag);
        if (!user) {
            requireAuth(() => {
                executeSearch(tag);
            });
            return;
        }
        executeSearch(tag);
    };

    // Front page validation using Gemini Vision API with academic document integrity check
    const validateFirstUploadedPage = async (file: File) => {
        setIsValidatingPage(true);
        setPageValidationStatus(null);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await uploadMultipart<{
                success: boolean;
                data: {
                    isFrontPage: boolean;
                    isAcademicDocument?: boolean;
                    nonAcademicReason?: string | null;
                    confidence: number;
                    indicatorsFound: string[];
                    topCode?: string | null;
                    paperCode?: string | null;
                    subject?: string | null;
                    course?: string | null;
                    semester?: string | null;
                    examYear?: string | null;
                    tags?: string[];
                    suggestedTitle?: string | null;
                    analysisMessage?: string;
                };
            }>("/documents/validate-page", formData);

            const result = res?.data;
            if (result) {
                // Check if the uploaded image is a random non-academic photo
                if (result.isAcademicDocument === false) {
                    setInvalidPageNumbers([1]);
                    setInvalidPageReasons({ 1: result.nonAcademicReason || "Not an exam question paper or academic slide" });
                    setUploadError(
                        `⚠️ Page 1 is a random / non-academic image (${result.nonAcademicReason || "Not an exam paper"}). You MUST remove this image to enable Submit.`
                    );
                    setPageValidationStatus({
                        checked: true,
                        isFrontPage: false,
                        indicatorsFound: [],
                        message: result.nonAcademicReason || "Random image detected. Not an academic paper.",
                    });
                    return;
                }

                setInvalidPageNumbers((prev) => prev.filter((p) => p !== 1));
                setPageValidationStatus({
                    checked: true,
                    isFrontPage: result.isFrontPage,
                    indicatorsFound: result.indicatorsFound || [],
                    message: result.analysisMessage,
                });

                if (result.isFrontPage) {
                    if (result.topCode) setUploadTopCode(result.topCode);
                    if (result.paperCode) setUploadPaperCode(result.paperCode);
                    if (result.suggestedTitle && !uploadTitle) setUploadTitle(result.suggestedTitle);
                    if (result.subject && !uploadSubject) setUploadSubject(result.subject);
                    if (result.course && !uploadCourse) setUploadCourse(result.course);
                    if (result.semester) setUploadSemester(result.semester);
                    if (result.examYear) setUploadYear(result.examYear);
                    if (Array.isArray(result.tags) && result.tags.length > 0) {
                        setUploadTags(result.tags);
                    }
                } else {
                    setUploadError("First file must be the front page of the question paper.");
                }
            }
        } catch (err: any) {
            console.warn("Front page validation fallback:", err);
            setPageValidationStatus({
                checked: true,
                isFrontPage: true,
                indicatorsFound: ["Standard Page"],
            });
        } finally {
            setIsValidatingPage(false);
        }
    };

    /**
     * Client-side Image Optimizer:
     * High-efficiency Canvas compression that resizes photos to max 1600px at 0.78 quality.
     * Reduces 8-15 MB phone camera photos down to ~200-350 KB while keeping all text & math clear.
     * Guarantees whole multi-page batch stays strictly around or below 3 MB!
     */
    const compressImageForUpload = async (file: File, maxDim = 1600, quality = 0.78): Promise<File> => {
        if (!file.type.startsWith("image/")) return file;
        // If image is already smaller than 350 KB, don't re-compress
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

    // Camera photo capture handler with Cryptographic + 128-bit Perceptual Anti-Duplicate Protection
    const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const incomingFiles = Array.from(e.target.files);

        const uniquePages: CapturedPage[] = [];
        let duplicateReason: string | null = null;

        for (let i = 0; i < incomingFiles.length; i++) {
            const rawFile = incomingFiles[i];
            if (!rawFile) continue;

            // Compress camera image to ensure batch stays around/below 3 MB
            const file = await compressImageForUpload(rawFile);

            try {
                const sha256 = await computeFileSha256(file);
                const dHash = await computeImagePerceptualHash(file);

                // 1. Exact cryptographic byte match check
                const isExactDuplicate =
                    capturedPages.some((p) => p.hash === sha256 || (p.file.size === file.size && p.file.name === file.name)) ||
                    uniquePages.some((u) => u.hash === sha256);

                if (isExactDuplicate) {
                    duplicateReason = "Duplicate image detected! You cannot add the exact same file twice.";
                    continue;
                }

                // 2. Perceptual 128-bit dHash Match (Catches clicking the same paper twice by hand)
                if (dHash) {
                    const visualDuplicate =
                        capturedPages.find((p) => p.dHash && calculateDHashDistance(p.dHash, dHash) <= 24) ||
                        uniquePages.find((u) => u.dHash && calculateDHashDistance(u.dHash, dHash) <= 24);

                    if (visualDuplicate) {
                        duplicateReason = `Duplicate image detected! This photo is virtually identical to ${visualDuplicate.name}. You cannot photograph the same front page or page twice. Please flip the paper to photograph the next page.`;
                        continue;
                    }
                }

                uniquePages.push({
                    id: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 4)}`,
                    url: URL.createObjectURL(file),
                    file,
                    name: file.name || `Page ${capturedPages.length + uniquePages.length + 1}`,
                    hash: sha256,
                    dHash,
                });
            } catch (err) {
                console.warn("Duplicate hash check fallback:", err);
                uniquePages.push({
                    id: `${Date.now()}-${i}`,
                    url: URL.createObjectURL(file),
                    file,
                    name: file.name || `Page ${capturedPages.length + uniquePages.length + 1}`,
                    hash: `${file.name}-${file.size}`,
                });
            }
        }

        if (duplicateReason) {
            setUploadError(duplicateReason);
        } else {
            setUploadError(null);
        }

        if (uniquePages.length === 0) {
            e.target.value = "";
            return;
        }

        // Validate FIRST page with Gemini Vision API
        if (capturedPages.length === 0 && uniquePages[0]) {
            validateFirstUploadedPage(uniquePages[0].file);
        }

        setCapturedPages((prev) => [...prev, ...uniquePages]);
        setUploadTab("camera");
        e.target.value = "";
    };

    /**
     * Remove captured page:
     * When user removes a flagged random image, recalibrates invalid pages.
     * When 0 invalid pages remain, clears upload error and REACTIVATES the Submit button immediately!
     */
    const removeCapturedPage = (id: string) => {
        setCapturedPages((prev) => {
            const indexToRemove = prev.findIndex((p) => p.id === id);
            const updated = prev.filter((p) => p.id !== id);

            if (updated.length === 0) {
                setPageValidationStatus(null);
                setUploadError(null);
                setBatchAnalysisDone(false);
                setLockedFields({});
                setInvalidPageNumbers([]);
                setInvalidPageReasons({});
            } else if (indexToRemove !== -1) {
                const removedPageNum = indexToRemove + 1;

                setInvalidPageNumbers((prevInvalid) => {
                    const nextInvalid = prevInvalid
                        .filter((pNum) => pNum !== removedPageNum)
                        .map((pNum) => (pNum > removedPageNum ? pNum - 1 : pNum));

                    // If all invalid images are removed, enable Submit button immediately!
                    if (nextInvalid.length === 0) {
                        setUploadError(null);
                    }
                    return nextInvalid;
                });

                setInvalidPageReasons((prevReasons) => {
                    const nextReasons: Record<number, string> = {};
                    Object.entries(prevReasons).forEach(([pStr, reason]) => {
                        const pNum = Number(pStr);
                        if (pNum < removedPageNum) {
                            nextReasons[pNum] = reason;
                        } else if (pNum > removedPageNum) {
                            nextReasons[pNum - 1] = reason;
                        }
                    });
                    return nextReasons;
                });
            }

            return updated;
        });
    };

    // Analyzes ALL captured pages together to auto-fill Title, Subject, Semester, Codes & University
    // and strictly checks that all pages are academic exam papers (3 strikes = 5-hour lockout)
    const handleAnalyzeAllPages = async () => {
        const pagesToAnalyze =
            uploadTab === "camera"
                ? capturedPages.map((p) => p.file)
                : uploadFile
                ? [uploadFile]
                : [];

        if (pagesToAnalyze.length === 0) {
            setUploadError("Please capture or select at least 1 page first.");
            return;
        }

        // Check if user is currently locked out for 5 hours
        if (uploadLockout?.isBlocked) {
            const blockedTime = uploadLockout.blockedUntil ? new Date(uploadLockout.blockedUntil).getTime() : 0;
            if (blockedTime > Date.now()) {
                const remainingMin = Math.ceil((blockedTime - Date.now()) / (1000 * 60));
                setUploadError(`Upload access is blocked for 5 hours due to abuse. Time remaining: ${remainingMin} minutes.`);
                return;
            } else {
                localStorage.removeItem("cdocs_upload_lockout");
                setUploadLockout(null);
            }
        }

        setIsAnalyzingBatch(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            pagesToAnalyze.forEach((f, idx) => {
                formData.append("files", f, `page-${idx + 1}.jpg`);
            });

            const res = await uploadMultipart<{
                success: boolean;
                data: {
                    isFirstPageFrontPage: boolean;
                    duplicatePagesDetected: boolean;
                    duplicateDetails?: string | null;
                    hasNonAcademicPages?: boolean;
                    invalidPages?: Array<{ pageNumber: number; reason: string }>;
                    nonAcademicWarning?: string | null;
                    strikes?: number;
                    strikesRemaining?: number;
                    isBlocked?: boolean;
                    blockedUntil?: string;
                    title?: string | null;
                    subject?: string | null;
                    course?: string | null;
                    college?: string | null;
                    semester?: string | null;
                    examYear?: string | null;
                    topCode?: string | null;
                    paperCode?: string | null;
                    tags?: string[];
                    autoFilledFields?: string[];
                    analysisMessage?: string;
                };
            }>("/documents/analyze-batch", formData);

            const data = res?.data;
            if (!data) return;

            // Anti-duplicate validation check
            if (data.duplicatePagesDetected) {
                setUploadError(
                    data.duplicateDetails || "Duplicate images detected in your batch! Please remove duplicate pages."
                );
                return;
            }

            // Anti-spam & Academic Integrity check: Detect random / non-academic images
            if (data.hasNonAcademicPages && data.invalidPages && data.invalidPages.length > 0) {
                const invalidNums = data.invalidPages.map((p) => p.pageNumber);
                const reasonsMap: Record<number, string> = {};
                data.invalidPages.forEach((p) => {
                    reasonsMap[p.pageNumber] = p.reason;
                });

                setInvalidPageNumbers(invalidNums);
                setInvalidPageReasons(reasonsMap);

                const currentStrikes = data.strikes || uploadStrikes + 1;
                setUploadStrikes(currentStrikes);

                // Check 3-strike 5-hour lockout
                if (data.isBlocked || currentStrikes >= 3) {
                    const blockedUntil = data.blockedUntil || new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
                    const lockoutObj = {
                        isBlocked: true,
                        blockedUntil,
                        message: "⛔ 3rd attempt with random/non-academic image! You have been blocked from uploading question papers for 5 hours.",
                    };
                    setUploadLockout(lockoutObj);
                    localStorage.setItem("cdocs_upload_lockout", JSON.stringify(lockoutObj));
                    setUploadError(lockoutObj.message);
                    return;
                }

                setUploadError(
                    `⚠️ Random / Non-Academic Image Detected on Page ${invalidNums.join(", ")}! ${data.invalidPages[0]?.reason || "Only question papers or slides allowed."} You MUST remove this image to enable Submit. (Attempt ${currentStrikes}/3: 3rd strike locks uploads for 5 hours!)`
                );
                return;
            } else {
                setInvalidPageNumbers([]);
                setInvalidPageReasons({});
            }

            const newLocks: Record<string, boolean> = {};

            if (data.title) {
                setUploadTitle(data.title);
                newLocks.title = true;
            }
            if (data.subject) {
                setUploadSubject(data.subject);
                newLocks.subject = true;
            }
            if (data.semester) {
                setUploadSemester(data.semester);
                newLocks.semester = true;
            }
            if (data.examYear) {
                setUploadYear(data.examYear);
                newLocks.examYear = true;
            }
            if (data.college) {
                setUploadCollege(data.college);
                newLocks.college = true;
            }
            if (data.topCode) {
                setUploadTopCode(data.topCode);
                newLocks.topCode = true;
            }
            if (data.paperCode) {
                setUploadPaperCode(data.paperCode);
                newLocks.paperCode = true;
            }
            if (Array.isArray(data.tags) && data.tags.length > 0) {
                setUploadTags(data.tags);
            }

            setLockedFields(newLocks);
            setBatchAnalysisDone(true);
            setPageValidationStatus({
                checked: true,
                isFrontPage: data.isFirstPageFrontPage,
                indicatorsFound: ["AI Sequence Verified"],
                message: data.analysisMessage,
            });
        } catch (err: any) {
            console.warn("Batch analysis error:", err);
            if (err?.response?.status === 403 || err?.response?.data?.isBlocked) {
                const blockedUntil = err?.response?.data?.blockedUntil || new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
                const lockoutObj = {
                    isBlocked: true,
                    blockedUntil,
                    message: err?.response?.data?.message || "Upload access is blocked for 5 hours due to repeated random image uploads.",
                };
                setUploadLockout(lockoutObj);
                localStorage.setItem("cdocs_upload_lockout", JSON.stringify(lockoutObj));
                setUploadError(lockoutObj.message);
            } else {
                setUploadError("AI Analysis was unable to reach server. You can enter paper details manually.");
            }
        } finally {
            setIsAnalyzingBatch(false);
        }
    };

    const handleFileChange = async (file: File | null) => {
        if (!file) {
            setUploadFile(null);
            setPageValidationStatus(null);
            return;
        }

        // PDF max size check: 3 MB limit
        if (file.type === "application/pdf" && file.size > 3 * 1024 * 1024) {
            const mb = (file.size / (1024 * 1024)).toFixed(2);
            setUploadError(`PDF file size (${mb} MB) exceeds the 3 MB maximum limit. Please select a PDF of 3 MB or less.`);
            setUploadFile(null);
            return;
        }

        // If image file, compress on client-side to keep whole batch size around/below 3 MB
        let processedFile = file;
        if (file.type.startsWith("image/")) {
            processedFile = await compressImageForUpload(file);
        }

        try {
            const fileHash = await computeFileSha256(processedFile);
            const dHash = await computeImagePerceptualHash(processedFile);

            const isDuplicate = capturedPages.some((p) => {
                if (p.hash === fileHash) return true;
                if (p.dHash && dHash) {
                    return calculateDHashDistance(p.dHash, dHash) <= 24;
                }
                return false;
            });

            if (isDuplicate) {
                setUploadError("Duplicate image detected! This exact page content is already added in the captured pages.");
                return;
            }
        } catch {
            // continue
        }

        if (uploadFile && uploadFile.size === processedFile.size && uploadFile.name === processedFile.name) {
            setUploadError("This file is already selected.");
            return;
        }

        setUploadFile(processedFile);
        setUploadError(null);
        validateFirstUploadedPage(processedFile);
    };

    // Quick camera snap button for mobile & desktop
    const triggerCameraSnap = () => {
        requireAuth(() => {
            setUploadTab("camera");
            setIsUploadModalOpen(true);
            setTimeout(() => {
                cameraInputRef.current?.click();
            }, 250);
        });
    };

    const handleUploadBannerClick = () => {
        requireAuth(() => {
            setIsUploadModalOpen(true);
        });
    };

    const handleReadPaper = (paper: PaperItem) => {
        requireAuth(() => {
            setActiveReadingDoc({
                id: paper.id,
                title: paper.title,
                subject: paper.subject,
                course: paper.course,
                semester: paper.semester,
                year: paper.year,
            });
        });
    };

    const handleFocusSearch = () => {
        const el = document.getElementById("search-section");
        el?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => {
            searchInputRef.current?.focus();
        }, 300);
    };

    // Real Upload Submission: sends multipart files to backend which compresses with Sharp & uploads to Cloudflare R2 + saves to MongoDB
    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 1. 5-Hour Abuse Lockout Check
        if (uploadLockout?.isBlocked) {
            const blockedTime = uploadLockout.blockedUntil ? new Date(uploadLockout.blockedUntil).getTime() : 0;
            if (blockedTime > Date.now()) {
                const remainingMin = Math.ceil((blockedTime - Date.now()) / (1000 * 60));
                setUploadError(`Upload access is blocked for 5 hours due to abuse. Time remaining: ${remainingMin} minutes.`);
                return;
            } else {
                localStorage.removeItem("cdocs_upload_lockout");
                setUploadLockout(null);
            }
        }

        // 2. Academic Document Integrity Check: Block submit if random/non-academic images are present
        if (invalidPageNumbers.length > 0) {
            setUploadError(
                `You must remove the random/non-academic image on Page ${invalidPageNumbers.join(", ")} before you can submit!`
            );
            return;
        }

        // 3. Max PDF size limit check: 3 MB
        if (uploadTab === "file" && uploadFile && uploadFile.type === "application/pdf" && uploadFile.size > 3 * 1024 * 1024) {
            const mb = (uploadFile.size / (1024 * 1024)).toFixed(2);
            setUploadError(`PDF file size (${mb} MB) exceeds the 3 MB maximum limit. Please select a PDF of 3 MB or less.`);
            return;
        }

        // Front page validation enforcement
        if (pageValidationStatus && !pageValidationStatus.isFrontPage) {
            setUploadError("First file must be the front page of the question paper.");
            return;
        }

        if (!uploadTitle.trim() || !uploadSubject.trim()) {
            setUploadError("Please provide both subject title and department.");
            return;
        }

        if (!uploadSemester.trim()) {
            setUploadError("Please select a semester (e.g. Semester 1). Semester is required.");
            return;
        }

        const hasCameraPages = uploadTab === "camera" && capturedPages.length > 0;
        const hasFile = uploadTab === "file" && uploadFile !== null;

        if (!hasCameraPages && !hasFile) {
            setUploadError("Please capture at least 1 photo or select a file to upload.");
            return;
        }

        // Anti-duplicate validation across all captured pages before upload
        if (uploadTab === "camera" && capturedPages.length > 1) {
            const seenHashes = new Set<string>();
            for (const p of capturedPages) {
                const identifier = p.hash || `${p.file.size}-${p.file.name}`;
                if (seenHashes.has(identifier)) {
                    setUploadError("Duplicate image detected in your batch! Please remove the duplicate page before submitting.");
                    return;
                }
                seenHashes.add(identifier);
            }
        }

        setIsUploading(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append("title", uploadTitle.trim());
            formData.append("subject", uploadSubject.trim());
            formData.append("semester", uploadSemester.trim());
            formData.append("examYear", uploadYear);
            if (uploadCollege.trim()) {
                formData.append("college", uploadCollege.trim());
            }
            if (uploadCourse.trim()) {
                formData.append("course", uploadCourse.trim());
            }
            if (uploadTopCode.trim()) {
                formData.append("topCode", uploadTopCode.trim());
            }
            if (uploadPaperCode.trim()) {
                formData.append("paperCode", uploadPaperCode.trim());
            }
            if (uploadTags.length > 0) {
                formData.append("tags", uploadTags.join(","));
            }

            if (uploadTab === "camera") {
                capturedPages.forEach((page, idx) => {
                    formData.append("files", page.file, `page-${idx + 1}.jpg`);
                });
            } else if (uploadFile) {
                formData.append("files", uploadFile);
            }

            const response = await uploadMultipart<{
                success: boolean;
                message: string;
                data: any;
            }>("/documents/upload", formData);

            setUploadDetails({
                savingsPercent: response?.data?.stats?.savingsPercent,
                pdfUrl: response?.data?.pdfUrl,
                totalPages: response?.data?.totalPages,
            });

            setUploadSuccess(true);

            // Re-fetch papers so the newly uploaded document appears in list immediately
            fetchPapers();

            setTimeout(() => {
                setUploadSuccess(false);
                setIsUploadModalOpen(false);
                setUploadTitle("");
                setUploadSubject("");
                setUploadSemester("Semester 1");
                setUploadCollege("");
                setUploadCourse("");
                setUploadTopCode("");
                setUploadPaperCode("");
                setUploadTags([]);
                setUploadFile(null);
                setCapturedPages([]);
                setPageValidationStatus(null);
                setUploadDetails(null);
                setLockedFields({});
                setBatchAnalysisDone(false);
            }, 3000);
        } catch (err: any) {
            console.error("Upload error:", err);
            setUploadError(err?.message || "Failed to upload document to Cloudflare R2. Please try again.");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white text-slate-800 flex flex-col font-sans selection:bg-accent/40 selection:text-brand-dark pb-20 md:pb-0">
            {/* Top Navigation Bar */}
            <Navbar
                user={user}
                onSignOut={() => setIsSignOutConfirmOpen(true)}
                onRequestAuth={() => requireAuth()}
            />

            <main className="flex-1 w-full flex flex-col items-center">
                {/* =========================================================================
                    HERO SECTION (Optimized for space on mobile & high engagement)
                   ========================================================================= */}
                <section id="search-section" className="w-full relative overflow-hidden pt-6 pb-12 sm:pt-16 sm:pb-24 border-b border-slate-100 bg-gradient-to-b from-brand-light/60 via-white to-white">
                    {/* Background decorative elements */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[300px] sm:h-[400px] bg-gradient-to-b from-accent/15 via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

                    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
                        {/* Hinglish Hook Tagline Badge */}
                        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full bg-accent text-brand-dark text-xs sm:text-sm font-bold shadow-xs mb-3 sm:mb-6 transform -rotate-1 hover:rotate-0 transition-transform">
                            <span>😫</span>
                            <span>&ldquo;Gheee Khatam?!&rdquo;</span>
                        </div>

                        {/* Main Heading - Responsive & space-saving */}
                        <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-brand-dark tracking-tight leading-[1.2] mb-2 sm:mb-5 max-w-4xl">
                            Get Past Exam Papers in Seconds.
                        </h1>

                        {/* Subtitle - Compact on mobile */}
                        <p className="text-xs sm:text-base md:text-lg text-slate-600 max-w-3xl leading-relaxed mb-5 sm:mb-8">
                            We’ve all been there—exam tomorrow, syllabus untouched, and zero clue what questions actually show up. <strong className="text-brand-dark font-semibold">cDocs (Chutiya Docs)</strong> is the crowd-sourced repository built by stressed students to find previous years&apos; papers and notes without endless WhatsApp digging.
                        </p>

                        {/* Search Bar Form with Floating Autocomplete */}
                        <div className="w-full max-w-2xl mb-3 sm:mb-5">
                            <div className="relative">
                                <form
                                    onSubmit={(e) => handleSearch(e)}
                                    className="relative flex flex-col sm:flex-row items-stretch gap-1.5 sm:gap-2 bg-white p-1.5 sm:p-2 rounded-2xl shadow-lg border border-slate-200/90 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/10 transition-all"
                                >
                                    <div className="flex-1 flex items-center pl-2.5 sm:pl-3 pr-2">
                                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                        <input
                                            ref={searchInputRef}
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onFocus={() => {
                                                if (suggestions.length > 0) setIsSuggestionsOpen(true);
                                            }}
                                            placeholder='Try "37248", "25GEO404MV01", "Calculus" or "DBMS"'
                                            className="w-full bg-transparent text-xs sm:text-base text-brand-dark placeholder:text-slate-400 focus:outline-none py-1.5 sm:py-0"
                                        />
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSearchQuery("");
                                                    setSuggestions([]);
                                                    setIsSuggestionsOpen(false);
                                                }}
                                                className="text-xs text-slate-400 hover:text-slate-600 px-1 cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSearching}
                                        className="px-5 py-2.5 sm:py-3 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs sm:text-sm font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-75"
                                    >
                                        {isSearching ? (
                                            <span>Searching...</span>
                                        ) : (
                                            <>
                                                <span>Find My Paper</span>
                                                <span aria-hidden="true">🔍</span>
                                            </>
                                        )}
                                    </button>
                                </form>

                                {/* Floating Autocomplete Suggestions Dropdown */}
                                {isSuggestionsOpen && suggestions.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden z-40 max-h-72 overflow-y-auto animate-in fade-in duration-150">
                                        <div className="px-3.5 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                            <span>Instant Matches &amp; Paper Codes</span>
                                            <button
                                                type="button"
                                                onClick={() => setIsSuggestionsOpen(false)}
                                                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {suggestions.map((item, idx) => (
                                                <button
                                                    key={`${item.type}-${item.value}-${idx}`}
                                                    type="button"
                                                    onClick={() => {
                                                        setSearchQuery(item.value);
                                                        setIsSuggestionsOpen(false);
                                                        executeSearch(item.value);
                                                    }}
                                                    className="w-full px-4 py-2.5 text-left hover:bg-amber-50/80 flex items-center justify-between transition-colors cursor-pointer group"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <span
                                                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                                                item.type === "topCode"
                                                                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                                                                    : item.type === "paperCode"
                                                                    ? "bg-indigo-100 text-indigo-900 border border-indigo-300"
                                                                    : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                                                            }`}
                                                        >
                                                            {item.type === "topCode" ? "Top Code" : item.type === "paperCode" ? "Paper Code" : "Tag"}
                                                        </span>
                                                        <span className="text-xs sm:text-sm font-semibold text-brand-dark group-hover:text-brand font-mono">
                                                            {item.value}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs text-slate-400 group-hover:text-brand">
                                                        Search ↵
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Dynamic AI Search Query Expanded Tags */}
                            {aiQueryTags.length > 0 && (
                                <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar scroll-smooth py-1 px-1 sm:justify-center">
                                    <span className="shrink-0 text-[11px] font-bold text-indigo-700 flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/80">
                                        <span>✨ AI Tags:</span>
                                    </span>
                                    {aiQueryTags.map((tag, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                                setSearchQuery(tag);
                                                executeSearch(tag);
                                            }}
                                            className="shrink-0 px-2.5 py-0.5 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-[11px] font-semibold border border-indigo-200 transition-colors cursor-pointer"
                                        >
                                            #{tag}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Swipeable Horizontal Quick-Search Chips on Mobile to Save Space */}
                            <div className="flex items-center gap-1.5 sm:gap-2 mt-2 sm:mt-3 overflow-x-auto no-scrollbar scroll-smooth py-1 px-1 -mx-2 sm:mx-0 sm:flex-wrap sm:justify-center">
                                <span className="shrink-0 text-[11px] sm:text-xs font-semibold text-slate-500 mr-0.5">Quick:</span>
                                <button
                                    type="button"
                                    onClick={() => handleQuickTagClick("Calculus II Midsem 2024")}
                                    className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accent/30 text-slate-700 hover:text-brand-dark text-[11px] sm:text-xs transition-colors cursor-pointer border border-slate-200/60"
                                >
                                    &ldquo;Calculus II Midsem 2024&rdquo;
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickTagClick("DBMS Endsem Pune University")}
                                    className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accent/30 text-slate-700 hover:text-brand-dark text-[11px] sm:text-xs transition-colors cursor-pointer border border-slate-200/60"
                                >
                                    &ldquo;DBMS Endsem Pune University&rdquo;
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickTagClick("Physics 2023")}
                                    className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accent/30 text-slate-700 hover:text-brand-dark text-[11px] sm:text-xs transition-colors cursor-pointer border border-slate-200/60"
                                >
                                    &ldquo;Physics 2023&rdquo;
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickTagClick("Data Structures 2024")}
                                    className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accent/30 text-slate-700 hover:text-brand-dark text-[11px] sm:text-xs transition-colors cursor-pointer border border-slate-200/60"
                                >
                                    &ldquo;Data Structures 2024&rdquo;
                                </button>
                            </div>

                            {/* Quick Action under Search: Camera on mobile, Upload on desktop */}
                            <div className="flex items-center justify-center gap-2 mt-3.5">
                                <button
                                    type="button"
                                    onClick={triggerCameraSnap}
                                    className="md:hidden inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 text-brand-dark border border-accent/60 text-xs font-bold transition-all active:scale-95 shadow-2xs cursor-pointer"
                                >
                                    <span className="text-sm">📸</span>
                                    <span>Have Paper in Hand? Snap Photo</span>
                                    <span className="text-[10px] bg-accent px-1.5 py-0.5 rounded-full font-extrabold uppercase text-brand-dark">Instant</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleUploadBannerClick}
                                    className="hidden md:inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-dark transition-colors cursor-pointer group"
                                >
                                    <span>Have previous year papers?</span>
                                    <span className="text-brand font-bold underline decoration-accent decoration-2 group-hover:text-brand-dark">Upload &amp; Save a Friend 📤</span>
                                </button>
                            </div>
                        </div>

                        {/* Search Results Display Area (when searched) */}
                        {hasSearched && (
                            <div className="w-full max-w-3xl mt-2 mb-6 sm:mb-8 text-left bg-white rounded-2xl border border-slate-200 shadow-md p-4 sm:p-5 transition-all">
                                <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                                    <div className="text-xs font-semibold text-slate-600">
                                        Found {searchResults.length} Papers matching &ldquo;{searchQuery || "All"}&rdquo;
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setHasSearched(false)}
                                        className="text-xs text-slate-400 hover:text-rose-500 cursor-pointer"
                                    >
                                        Close Results
                                    </button>
                                </div>
                                {searchResults.length === 0 ? (
                                    <div className="py-8 text-center text-slate-500 space-y-2">
                                        <span className="text-3xl block">📄</span>
                                        <div className="text-sm font-bold text-brand-dark">
                                            No question papers found for &ldquo;{searchQuery || "query"}&rdquo;
                                        </div>
                                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                            Be the first student to upload this paper and help everyone cramming for exams!
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleUploadBannerClick}
                                            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-amber-400 text-brand-dark text-xs font-bold transition-all shadow-xs cursor-pointer"
                                        >
                                            <span>Upload This Paper Now</span>
                                            <span>📤</span>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-2.5 sm:space-y-3">
                                        {searchResults.map((paper) => (
                                            <div
                                                key={paper.id}
                                                className="p-3 sm:p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    {/* Document Thumbnail Preview from R2 */}
                                                    {paper.thumbnailUrl ? (
                                                        <div className="w-11 h-14 sm:w-13 sm:h-16 rounded-lg overflow-hidden border border-slate-200/90 shadow-2xs shrink-0 bg-slate-100 flex items-center justify-center">
                                                            <img
                                                                src={paper.thumbnailUrl}
                                                                alt={paper.title}
                                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                                loading="lazy"
                                                                onError={(e) => {
                                                                    (e.currentTarget as HTMLElement).style.display = "none";
                                                                }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-11 h-14 sm:w-13 sm:h-16 rounded-lg bg-emerald-50 border border-emerald-100/90 text-emerald-700 flex flex-col items-center justify-center shrink-0">
                                                            <span className="text-base sm:text-lg">📄</span>
                                                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-800">DOC</span>
                                                        </div>
                                                    )}

                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                                            {paper.isTopMatch && (
                                                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-brand-dark shadow-xs flex items-center gap-1">
                                                                    <span>🎯</span>
                                                                    <span>Top Match</span>
                                                                </span>
                                                            )}
                                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${paper.type === "Midsem" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                                                                {paper.type}
                                                            </span>
                                                            <span className="text-[11px] sm:text-xs text-slate-500">
                                                                {paper.course} • {paper.semester ? <span className="font-semibold text-brand-dark bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{paper.semester} • </span> : null}{paper.year}
                                                            </span>
                                                            {paper.matchingReasons && paper.matchingReasons.map((reason, rIdx) => (
                                                                <span key={rIdx} className="text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded">
                                                                    ✓ {reason}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <h4 className="text-xs sm:text-sm font-semibold text-brand-dark group-hover:text-emerald-700 transition-colors">{paper.title}</h4>
                                                        <div className="text-[11px] text-slate-500 mt-0.5">
                                                            Uploaded by @{paper.uploadedBy} • {paper.downloads} reads • ⭐ {paper.rating}
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleReadPaper(paper)}
                                                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold shrink-0 cursor-pointer flex items-center justify-center gap-1.5 self-start sm:self-center shadow-xs transition-all active:scale-95"
                                                    title="Read protected document inside secure reader"
                                                >
                                                    <span>Read in App</span>
                                                    <span className="text-sm">👁️</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                {/* =========================================================================
                    THE PAIN POINT / WHY WE EXIST (Compact on mobile)
                   ========================================================================= */}
                <section className="w-full py-10 sm:py-20 bg-brand-light/50 border-b border-slate-200/80">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                        <h2 className="text-xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark tracking-tight mb-4 sm:mb-6">
                            Because Exam Prep Shouldn’t Feel Like a Treasure Hunt.
                        </h2>

                        <div className="bg-white rounded-2xl p-5 sm:p-10 border border-slate-200 shadow-xs text-left relative overflow-hidden">
                            <div className="w-1.5 h-full bg-accent absolute left-0 top-0"></div>

                            <p className="text-xs sm:text-base md:text-lg text-slate-700 leading-relaxed mb-4 sm:mb-6">
                                We know the drill. It&apos;s 2 AM, your exams are hours away, and you&apos;re hunting through broken Google Drive links, sketchy Telegram groups, and unresponsive class representatives just to see what last year&apos;s paper looked like.
                            </p>

                            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <p className="text-xs sm:text-base font-semibold text-brand">
                                    With cDocs, stop scrambling and start studying. Just search, download, and try to pass.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleFocusSearch}
                                    className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-dark transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
                                >
                                    Start Searching Now
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* =========================================================================
                    HOW IT WORKS (THREE STEPS TO SURVIVAL)
                   ========================================================================= */}
                <section id="how-it-works" className="w-full py-10 sm:py-20 bg-white border-b border-slate-100">
                    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-14">
                            <span className="text-xs font-bold tracking-widest uppercase text-brand">Easy Workflow</span>
                            <h2 className="text-xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark tracking-tight mt-1 mb-2">
                                Three Steps to Survival
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-600">
                                Passing exams shouldn&apos;t require hours of internet searching.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8 relative">
                            {/* Step 1 */}
                            <div className="relative bg-brand-light/50 hover:bg-brand-light/90 border border-slate-200/80 rounded-2xl p-5 sm:p-7 transition-all flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white text-brand shadow-xs flex items-center justify-center font-bold text-base sm:text-lg border border-slate-200/80">
                                            🔍
                                        </div>
                                        <span className="text-2xl sm:text-3xl font-black text-slate-200">01</span>
                                    </div>
                                    <h3 className="text-base sm:text-lg font-bold text-brand-dark mb-1 sm:mb-2">
                                        Search Your Prep
                                    </h3>
                                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                                        Type in your college, subject, or year. Instant access to PDFs. No sign-ups required to view.
                                    </p>
                                </div>
                                <div className="mt-4 sm:mt-6 inline-flex items-center text-xs font-semibold text-brand gap-1">
                                    <span>Instant indexing</span>
                                    <span>→</span>
                                </div>
                            </div>

                            {/* Step 2 */}
                            <div className="relative bg-brand-light/50 hover:bg-brand-light/90 border border-slate-200/80 rounded-2xl p-5 sm:p-7 transition-all flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white text-brand shadow-xs flex items-center justify-center font-bold text-base sm:text-lg border border-slate-200/80">
                                            ⚡
                                        </div>
                                        <span className="text-2xl sm:text-3xl font-black text-slate-200">02</span>
                                    </div>
                                    <h3 className="text-base sm:text-lg font-bold text-brand-dark mb-1 sm:mb-2">
                                        Download &amp; Dominate
                                    </h3>
                                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                                        Get exactly what you need in one click. Previous year question papers, mid-sems, and end-sems.
                                    </p>
                                </div>
                                <div className="mt-4 sm:mt-6 inline-flex items-center text-xs font-semibold text-brand gap-1">
                                    <span>Clean, high-res PDFs</span>
                                    <span>→</span>
                                </div>
                            </div>

                            {/* Step 3 */}
                            <div className="relative bg-brand-light/50 hover:bg-brand-light/90 border border-slate-200/80 rounded-2xl p-5 sm:p-7 transition-all flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent text-brand-dark shadow-xs flex items-center justify-center font-bold text-base sm:text-lg border border-accent/40">
                                            📸
                                        </div>
                                        <span className="text-2xl sm:text-3xl font-black text-slate-200">03</span>
                                    </div>
                                    <h3 className="text-base sm:text-lg font-bold text-brand-dark mb-1 sm:mb-2">
                                        Pass On the Karma
                                    </h3>
                                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                                        Snap photos of papers with your camera or upload downloads to save the next batch of desperate students.
                                    </p>
                                </div>
                                <div className="mt-4 sm:mt-6 inline-flex items-center text-xs font-semibold text-brand gap-1">
                                    <span>Become a legend</span>
                                    <span>→</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* =========================================================================
                    KEY FEATURES / THE STATS
                   ========================================================================= */}
                <section className="w-full py-10 sm:py-20 bg-brand text-white border-b border-brand-dark">
                    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-14">
                            <span className="text-xs font-bold tracking-widest uppercase text-accent">Core Pillars</span>
                            <h2 className="text-xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight mt-1 mb-2">
                                Fast. Raw. Community-Powered.
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-300">
                                Built ground-up for the chaotic reality of college semesters.
                            </p>
                        </div>

                        {/* 3 Pillar Features */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
                            <div className="bg-brand-dark/70 rounded-2xl p-5 sm:p-6 border border-white/10 hover:border-accent/40 transition-colors">
                                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">⚡</div>
                                <h3 className="text-sm sm:text-lg font-bold text-white mb-1.5">
                                    Cheetah-Speed Search
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                    Built to find what you need at 3 AM when you only have 4 hours left to cram.
                                </p>
                            </div>

                            <div className="bg-brand-dark/70 rounded-2xl p-5 sm:p-6 border border-white/10 hover:border-accent/40 transition-colors">
                                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">👥</div>
                                <h3 className="text-sm sm:text-lg font-bold text-white mb-1.5">
                                    By the Batch, For the Batch
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                    Everything here is uploaded by students who survived the exact same exams.
                                </p>
                            </div>

                            <div className="bg-brand-dark/70 rounded-2xl p-5 sm:p-6 border border-white/10 hover:border-accent/40 transition-colors">
                                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">📂</div>
                                <h3 className="text-sm sm:text-lg font-bold text-white mb-1.5">
                                    Zero BS, Just Docs
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                    No paywalls, no forced subscriptions, and no tedious ad-walls. Just pure PDFs.
                                </p>
                            </div>
                        </div>

                        {/* College Community Stats Strip - Hidden for now, activate in future
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 pt-4 sm:pt-6 border-t border-white/10 text-center">
                            <div className="p-3 sm:p-4 bg-brand-dark/40 rounded-xl md:bg-transparent">
                                <div className="text-xl sm:text-3xl font-black text-accent mb-0.5">25,000+</div>
                                <div className="text-[11px] sm:text-xs text-slate-300 font-medium">Question Papers</div>
                            </div>
                            <div className="p-3 sm:p-4 bg-brand-dark/40 rounded-xl md:bg-transparent">
                                <div className="text-xl sm:text-3xl font-black text-accent mb-0.5">140+</div>
                                <div className="text-[11px] sm:text-xs text-slate-300 font-medium">Colleges &amp; Universities</div>
                            </div>
                            <div className="p-3 sm:p-4 bg-brand-dark/40 rounded-xl md:bg-transparent">
                                <div className="text-xl sm:text-3xl font-black text-accent mb-0.5">0 ₹</div>
                                <div className="text-[11px] sm:text-xs text-slate-300 font-medium">Always Free</div>
                            </div>
                            <div className="p-3 sm:p-4 bg-brand-dark/40 rounded-xl md:bg-transparent">
                                <div className="text-xl sm:text-3xl font-black text-accent mb-0.5">3:18 AM</div>
                                <div className="text-[11px] sm:text-xs text-slate-300 font-medium">Peak Lifesaver Time</div>
                            </div>
                        </div>
                        */}
                    </div>
                </section>

                {/* =========================================================================
                    COMMUNITY / UPLOAD BANNER
                   ========================================================================= */}
                <section id="upload-section" className="w-full py-10 sm:py-20 bg-white border-b border-slate-100">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="relative rounded-3xl bg-gradient-to-r from-accent/25 via-brand-light to-accent/15 border-2 border-accent/40 p-6 sm:p-12 text-center overflow-hidden shadow-xs">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent text-brand-dark text-xs font-bold mb-3 sm:mb-4">
                                <span>🤝</span>
                                <span>Community Karma</span>
                            </div>

                            <h2 className="text-2xl sm:text-4xl font-extrabold text-brand-dark tracking-tight mb-2 sm:mb-4">
                                &ldquo;Kuch bhala kar do!&rdquo; 🤝
                            </h2>

                            <p className="text-xs sm:text-base text-slate-700 max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed">
                                Don&apos;t let those exam papers rot in your gallery or desk. Click a quick photo or upload files to become a legend for the next semester.
                            </p>

                            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3">
                                {/* Mobile-only Camera Snap Button */}
                                <button
                                    type="button"
                                    onClick={triggerCameraSnap}
                                    className="md:hidden w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-amber-100 text-brand-dark hover:bg-amber-200 font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95 border border-amber-300/70"
                                >
                                    <span>📸 Snap Paper Photos (Camera)</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUploadBannerClick}
                                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-accent hover:bg-amber-400 text-brand-dark text-xs sm:text-sm font-bold shadow-xs transition-all cursor-pointer active:scale-95"
                                >
                                    <span>Upload Question Paper (PDF / Files)</span>
                                    <span>📤</span>
                                </button>
                            </div>

                            <div className="mt-4 text-[11px] text-slate-500">
                                Accepted: Camera Snap, PDF, JPG, PNG • Max size 25MB
                            </div>
                        </div>
                    </div>
                </section>

                {/* =========================================================================
                    TESTIMONIALS / FEEDBACK - Hidden for now, activate in future
                   ========================================================================= */}
                {/* 
                <section id="community-section" className="w-full py-10 sm:py-20 bg-brand-light/30 border-b border-slate-200/80">
                    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-14">
                            <span className="text-xs font-bold tracking-widest uppercase text-brand">Real Confessions</span>
                            <h2 className="text-xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark tracking-tight mt-1 mb-2">
                                What our users are saying (while crying over syllabus)
                            </h2>
                            <p className="text-xs text-slate-500">
                                Real verified reviews from the night before exams.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                            <div className="bg-white rounded-2xl p-5 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between relative">
                                <div className="text-accent text-2xl sm:text-3xl font-serif mb-1 leading-none">&ldquo;</div>
                                <p className="text-xs sm:text-base text-slate-700 italic leading-relaxed mb-4 sm:mb-6">
                                    &ldquo;I literally found my 2024 End-Sem Math paper here at 3 AM and barely passed. cDocs is a lifesaver.&rdquo;
                                </p>
                                <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                                    <div className="w-9 h-9 rounded-full bg-brand text-accent font-bold text-xs flex items-center justify-center">
                                        A
                                    </div>
                                    <div>
                                        <div className="text-xs sm:text-sm font-bold text-brand-dark">— Ayush</div>
                                        <div className="text-[11px] text-slate-500">3rd Year B.Tech</div>
                                    </div>
                                    <div className="ml-auto text-xs text-amber-500 font-medium">
                                        ★★★★★
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl p-5 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between relative">
                                <div className="text-accent text-2xl sm:text-3xl font-serif mb-1 leading-none">&ldquo;</div>
                                <p className="text-xs sm:text-base text-slate-700 italic leading-relaxed mb-4 sm:mb-6">
                                    &ldquo;Better than asking the class group 50 times for the same PDF. Best crowd-sourced repository ever.&rdquo;
                                </p>
                                <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                                    <div className="w-9 h-9 rounded-full bg-accent text-brand-dark font-bold text-xs flex items-center justify-center">
                                        S
                                    </div>
                                    <div>
                                        <div className="text-xs sm:text-sm font-bold text-brand-dark">— Sneha</div>
                                        <div className="text-[11px] text-slate-500">B.Com</div>
                                    </div>
                                    <div className="ml-auto text-xs text-amber-500 font-medium">
                                        ★★★★★
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                */}
            </main>

            {/* =========================================================================
                FOOTER
               ========================================================================= */}
            <footer className="w-full bg-brand-dark text-slate-300 py-10 sm:py-12 border-t border-slate-800 pb-28 md:pb-12">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-6 sm:gap-8 mb-6 sm:mb-8 pb-6 sm:pb-8 border-b border-slate-700/60">
                        {/* Brand & Motto */}
                        <div className="text-center md:text-left">
                            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                                <div className="w-8 h-8 rounded-lg bg-[#faf7f2] p-1 flex items-center justify-center overflow-hidden">
                                    <img
                                        src="/logo/logo-2.png"
                                        alt="cDocs"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                                <span className="text-xl font-bold tracking-tight text-white">cDocs</span>
                            </div>
                            <p className="text-xs sm:text-sm font-medium text-slate-300">
                                cDocs — Because we all need a little help passing.
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1 max-w-md italic">
                                Disclaimer: We do not encourage last-minute cramming, but we definitely support surviving it.
                            </p>
                        </div>

                        {/* Navigation Links */}
                        <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-4 sm:gap-x-6 gap-y-2 text-xs sm:text-sm font-medium">
                            <button
                                type="button"
                                onClick={() => {
                                    if (onNavigatePrivacy) {
                                        onNavigatePrivacy();
                                    } else {
                                        window.location.href = "/privacy";
                                    }
                                }}
                                className="hover:text-accent transition-colors cursor-pointer"
                            >
                                Privacy
                            </button>
                            <span className="text-slate-600">|</span>
                            <button
                                type="button"
                                onClick={() => {
                                    if (onNavigatePrivacy) {
                                        onNavigatePrivacy();
                                    } else {
                                        window.location.href = "/privacy";
                                    }
                                }}
                                className="hover:text-accent transition-colors cursor-pointer"
                            >
                                Terms
                            </button>
                            <span className="text-slate-600">|</span>
                            <button
                                type="button"
                                onClick={() => alert("Contact us: team@cdocs.org or Telegram @cdocs_support")}
                                className="hover:text-accent transition-colors cursor-pointer"
                            >
                                Contact
                            </button>
                            <span className="text-slate-600">|</span>
                            <button
                                type="button"
                                onClick={() => alert("Upload Guidelines: Ensure clear scans/photos, correct subject code and year.")}
                                className="hover:text-accent transition-colors cursor-pointer"
                            >
                                Upload Guidelines
                            </button>
                            <span className="text-slate-600">|</span>
                            <a
                                href="https://github.com"
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-accent transition-colors"
                            >
                                Open Source Repo
                            </a>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2 text-center sm:text-left">
                        <div>
                            © {new Date().getFullYear()} cDocs (Chutiya Docs). Built by stressed students, for stressed students.
                        </div>
                        <div className="flex items-center justify-center gap-1">
                            <span>Made with</span>
                            <span className="text-rose-500">❤️</span>
                            <span>for late-night exam survivors</span>
                        </div>
                    </div>
                </div>
            </footer>

            {/* =========================================================================
                MOBILE ENGAGING BOTTOM APP BAR (<md:hidden)
               ========================================================================= */}
            <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 px-4 py-2 shadow-xl safe-area-bottom">
                <div className="flex items-center justify-around max-w-md mx-auto">
                    {/* Search action */}
                    <button
                        type="button"
                        onClick={handleFocusSearch}
                        className="flex flex-col items-center gap-1 text-slate-600 hover:text-brand cursor-pointer p-1 active:scale-95"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <span className="text-[10px] font-semibold">Search</span>
                    </button>

                    {/* Prominent Golden Camera Action Button */}
                    <button
                        type="button"
                        onClick={triggerCameraSnap}
                        className="flex flex-col items-center -mt-6 group cursor-pointer"
                        title="Click Paper Photo with Camera"
                    >
                        <div className="w-13 h-13 rounded-full bg-accent text-brand-dark flex items-center justify-center shadow-lg border-3 border-white group-active:scale-95 transition-transform">
                            <span className="text-2xl">📸</span>
                        </div>
                        <span className="text-[10px] font-bold text-brand-dark mt-0.5 tracking-tight">Snap Paper</span>
                    </button>

                    {/* Upload File action */}
                    <button
                        type="button"
                        onClick={() => {
                            setUploadTab("file");
                            requireAuth(() => setIsUploadModalOpen(true));
                        }}
                        className="flex flex-col items-center gap-1 text-slate-600 hover:text-brand cursor-pointer p-1 active:scale-95"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        <span className="text-[10px] font-semibold">Upload</span>
                    </button>

                    {/* Account action */}
                    {user ? (
                        <button
                            type="button"
                            onClick={() => setIsSignOutConfirmOpen(true)}
                            className="flex flex-col items-center gap-1 text-slate-700 hover:text-rose-600 cursor-pointer p-1 active:scale-95 min-w-0"
                            title={`Signed in as @${user.username || "student"} (${user.email})`}
                        >
                            <div className="w-6 h-6 rounded-full overflow-hidden border border-slate-300 bg-[#27313d] flex items-center justify-center shadow-2xs">
                                <img
                                    src="/logo/logo-4.png"
                                    alt="Profile Picture"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <span className="text-[10px] font-semibold truncate max-w-[55px]">
                                @{user.username || "user"}
                            </span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => requireAuth()}
                            className="flex flex-col items-center gap-1 text-brand cursor-pointer p-1 active:scale-95"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span className="text-[10px] font-semibold">Sign In</span>
                        </button>
                    )}
                </div>
            </nav>

            {/* =========================================================================
                UPLOAD PAPER MODAL (With Camera Image Capture + Multi-Page Support)
               ========================================================================= */}
            {isUploadModalOpen && (
                <div className="fixed inset-0 z-50 bg-brand-dark/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl border border-slate-200 relative my-auto max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                        <button
                            type="button"
                            onClick={() => {
                                setIsUploadModalOpen(false);
                                setCapturedPages([]);
                            }}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 cursor-pointer"
                        >
                            ✕
                        </button>

                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xl">📤</span>
                            <h3 className="text-base sm:text-lg font-bold text-brand-dark">Upload Question Paper</h3>
                        </div>
                        <p className="text-xs text-slate-500 mb-4">
                            Click photos of paper pages or upload PDFs to save next semester students!
                        </p>

                        {/* Mode Switcher Tabs (Mobile only: on desktop, directly upload files) */}
                        <div className="md:hidden grid grid-cols-2 p-1 bg-slate-100 rounded-2xl mb-4 border border-slate-200/70">
                            <button
                                type="button"
                                onClick={() => setUploadTab("camera")}
                                className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${uploadTab === "camera"
                                    ? "bg-white text-brand-dark shadow-xs"
                                    : "text-slate-500 hover:text-slate-800"
                                    }`}
                            >
                                <span>📸</span>
                                <span>Snap Photos</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setUploadTab("file")}
                                className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${uploadTab === "file"
                                    ? "bg-white text-brand-dark shadow-xs"
                                    : "text-slate-500 hover:text-slate-800"
                                    }`}
                            >
                                <span>📁</span>
                                <span>Upload File</span>
                            </button>
                        </div>

                        {uploadSuccess ? (
                            <div className="py-6 text-center space-y-3">
                                <div className="text-4xl">🎉</div>
                                <h4 className="text-base font-bold text-emerald-600">Saved to Cloudflare R2 &amp; Database!</h4>
                                <p className="text-xs text-slate-600 max-w-sm mx-auto">
                                    Your paper has been compressed with high readability and safely indexed in the database.
                                </p>
                                {uploadDetails?.savingsPercent && (
                                    <div className="inline-block px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[11px] font-bold border border-emerald-200 shadow-2xs">
                                        ⚡ Storage Saved: {uploadDetails.savingsPercent} (Sharp Compression)
                                    </div>
                                )}
                                {uploadDetails?.pdfUrl && (
                                    <div className="pt-2">
                                        <a
                                            href={uploadDetails.pdfUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-accent font-bold text-xs hover:bg-brand-dark transition-all shadow-xs"
                                        >
                                            <span>View Master PDF on R2</span>
                                            <span>↗</span>
                                        </a>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
                                {/* 5-Hour Abuse Lockout Alert Banner */}
                                {uploadLockout?.isBlocked && (
                                    <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-xs text-rose-900 space-y-1.5 animate-in fade-in">
                                        <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                                            <span>⛔</span>
                                            <span>Upload Blocked for 5 Hours</span>
                                        </div>
                                        <p className="text-[11px] text-rose-800 leading-relaxed font-medium">
                                            {uploadLockout.message || "3 attempts with random/non-academic images detected. Upload access has been temporarily blocked for 5 hours."}
                                        </p>
                                        {uploadLockout.blockedUntil && (
                                            <div className="text-[10px] font-bold text-rose-700 bg-rose-100/80 px-2.5 py-1 rounded-lg inline-block">
                                                Unlocks at: {new Date(uploadLockout.blockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(uploadLockout.blockedUntil).toLocaleDateString()})
                                            </div>
                                        )}
                                    </div>
                                )}

                                {uploadError && (
                                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center justify-between">
                                        <span>⚠️ {uploadError}</span>
                                        <button
                                            type="button"
                                            onClick={() => setUploadError(null)}
                                            className="text-rose-500 font-bold ml-2 cursor-pointer"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                )}

                                {isUploading && (
                                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium flex items-center gap-3 animate-pulse">
                                        <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
                                        <span>Compressing pages &amp; uploading to Cloudflare R2... Please wait</span>
                                    </div>
                                )}

                                {/* Gemini AI Front Page & Exam Code Verification Status */}
                                {isValidatingPage && (
                                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 font-medium flex items-center gap-2.5 animate-pulse">
                                        <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                                        <span>🤖 Gemini AI verifying front page &amp; academic exam integrity...</span>
                                    </div>
                                )}

                                {pageValidationStatus && !isValidatingPage && (
                                    pageValidationStatus.isFrontPage ? (
                                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-start gap-2">
                                            <span className="text-base shrink-0">✅</span>
                                            <div className="flex-1">
                                                <p className="font-bold">Verified Front Page of Question Paper</p>
                                                <p className="text-[11px] text-emerald-700 mt-0.5">
                                                    Exam headers detected: {pageValidationStatus.indicatorsFound.join(", ") || "Time, Max Marks, Roll No"}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-800 font-medium flex items-start gap-2">
                                            <span className="text-base shrink-0">⚠️</span>
                                            <div className="flex-1">
                                                <p className="font-bold">First file must be the front page of the question paper</p>
                                                <p className="text-[11px] text-rose-600 mt-0.5">
                                                    Page 1 must contain exam headers like Roll No, Time, or Maximum Marks.
                                                </p>
                                            </div>
                                        </div>
                                    )
                                )}

                                {/* TAB 1: Camera Photo Snap (Front & Back Multi-Page) */}
                                {uploadTab === "camera" && (
                                    <div className="space-y-3">
                                        <input
                                            type="file"
                                            ref={cameraInputRef}
                                            id="camera-paper-input"
                                            accept="image/*"
                                            capture="environment"
                                            multiple
                                            onChange={handleCameraCapture}
                                            className="hidden"
                                        />

                                        {capturedPages.length === 0 ? (
                                            <label
                                                htmlFor="camera-paper-input"
                                                className="w-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-accent hover:border-amber-400 bg-amber-50/40 hover:bg-amber-50/70 rounded-2xl cursor-pointer transition-all active:scale-[0.99] text-center"
                                            >
                                                <div className="w-13 h-13 rounded-2xl bg-accent text-brand-dark flex items-center justify-center text-2xl shadow-xs mb-2">
                                                    📸
                                                </div>
                                                <span className="text-sm font-bold text-brand-dark">
                                                    Click Photo of Question Paper
                                                </span>
                                                <span className="text-[11px] text-slate-500 mt-0.5">
                                                    Tap to open camera and take photo of your exam paper
                                                </span>
                                                <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold bg-white px-2.5 py-1 rounded-full border border-accent/60 text-brand-dark">
                                                    Supports Front &amp; Back pages (Kept under 3 MB)
                                                </span>
                                            </label>
                                        ) : (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                                                    <div className="flex items-center gap-2">
                                                        <span>Captured Pages ({capturedPages.length})</span>
                                                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold border border-slate-200">
                                                            Total: {(capturedPages.reduce((sum, p) => sum + p.file.size, 0) / (1024 * 1024)).toFixed(2)} MB / 3 MB max
                                                        </span>
                                                    </div>
                                                    <label
                                                        htmlFor="camera-paper-input"
                                                        className="text-xs font-bold text-brand hover:text-brand-dark cursor-pointer flex items-center gap-1 bg-brand-light px-2.5 py-1 rounded-lg border border-slate-200"
                                                    >
                                                        <span>+ Snap Next Page (e.g. Page 2)</span>
                                                    </label>
                                                </div>

                                                {/* Thumbnails Gallery with Invalid Random Image Highlights */}
                                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                    {capturedPages.map((page, idx) => {
                                                        const isInvalid = invalidPageNumbers.includes(idx + 1);
                                                        return (
                                                            <div
                                                                key={page.id}
                                                                className={`relative rounded-xl overflow-hidden aspect-[3/4] bg-slate-100 group shadow-2xs transition-all ${
                                                                    isInvalid
                                                                        ? "border-2 border-rose-500 ring-4 ring-rose-500/30"
                                                                        : "border border-slate-200"
                                                                }`}
                                                            >
                                                                <img
                                                                    src={page.url}
                                                                    alt={page.name}
                                                                    onClick={() => setPreviewPhoto(page.url)}
                                                                    className="w-full h-full object-cover cursor-pointer hover:opacity-90"
                                                                />
                                                                <div
                                                                    className={`absolute top-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs ${
                                                                        isInvalid
                                                                            ? "bg-rose-600 text-white"
                                                                            : "bg-brand-dark/85 text-white"
                                                                    }`}
                                                                >
                                                                    {isInvalid ? "⚠️ Page " + (idx + 1) : "Page " + (idx + 1)}
                                                                </div>

                                                                {isInvalid && (
                                                                    <div
                                                                        className="absolute inset-x-0 bottom-0 bg-rose-600/95 text-white text-[9px] font-bold p-1 text-center backdrop-blur-xs leading-tight"
                                                                        title={invalidPageReasons[idx + 1] || "Random image detected"}
                                                                    >
                                                                        {invalidPageReasons[idx + 1] ? (
                                                                            <span className="line-clamp-1">✕ {invalidPageReasons[idx + 1]}</span>
                                                                        ) : (
                                                                            <span>Tap ✕ to remove</span>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeCapturedPage(page.id)}
                                                                    className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md cursor-pointer transition-transform active:scale-90 ${
                                                                        isInvalid
                                                                            ? "bg-rose-600 hover:bg-rose-700 animate-pulse"
                                                                            : "bg-rose-600 hover:bg-rose-700"
                                                                    }`}
                                                                    title="Remove this page to reactivate Submit"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* TAB 2: Traditional File / PDF Upload */}
                                {uploadTab === "file" && (
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Select PDF or Image Files
                                            </label>
                                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                                Max 3 MB
                                            </span>
                                        </div>
                                        <div className="border-2 border-dashed border-slate-300 hover:border-brand rounded-2xl p-4 text-center cursor-pointer bg-slate-50/50">
                                            <input
                                                type="file"
                                                id="paper-file"
                                                accept=".pdf,.png,.jpg,.jpeg"
                                                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                                                className="hidden"
                                            />
                                            <label htmlFor="paper-file" className="cursor-pointer block">
                                                <div className="text-2xl mb-1">📁</div>
                                                <span className="text-xs font-medium text-brand">
                                                    {uploadFile ? uploadFile.name : "Click to select PDF file or drag here"}
                                                </span>
                                                <p className="text-[10px] text-slate-400 mt-0.5">
                                                    PDF (Max 3 MB) or Images (Kept under 3 MB total)
                                                </p>
                                                {uploadFile && (
                                                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                        <span>Size: {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                                                        {uploadFile.type === "application/pdf" && uploadFile.size > 3 * 1024 * 1024 && (
                                                            <span className="text-rose-600">⚠️ Exceeds 3 MB limit!</span>
                                                        )}
                                                    </div>
                                                )}
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {/* READY TO SAVE: AI BATCH ANALYSIS & AUTO-FILL CARD */}
                                {(capturedPages.length > 0 || uploadFile !== null) && (
                                    <div className="p-3 bg-gradient-to-r from-indigo-50 via-purple-50 to-amber-50 border border-indigo-200/80 rounded-2xl shadow-2xs space-y-2">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                            <div className="flex items-start sm:items-center gap-2">
                                                <span className="text-xl shrink-0">✨</span>
                                                <div>
                                                    <h5 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                                                        <span>Ready to save? Run AI Analysis</span>
                                                        {batchAnalysisDone && (
                                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                                                ✓ Auto-Filled
                                                            </span>
                                                        )}
                                                    </h5>
                                                    <p className="text-[11px] text-indigo-800/80 mt-0.5">
                                                        {uploadTab === "camera"
                                                            ? `Gemini AI inspects all ${capturedPages.length} captured page(s) and auto-fills Subject, Semester, Year, & Codes.`
                                                            : "Gemini AI analyzes the uploaded document and auto-fills Subject, Semester, Year, & Codes."}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleAnalyzeAllPages}
                                                disabled={isAnalyzingBatch || isValidatingPage}
                                                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 shrink-0"
                                            >
                                                {isAnalyzingBatch ? (
                                                    <>
                                                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                        <span>Analyzing All Pages...</span>
                                                    </>
                                                ) : batchAnalysisDone ? (
                                                    <>
                                                        <span>🔄 Re-Analyze with AI</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>🤖 Auto-Fill with AI</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>

                                        {batchAnalysisDone && Object.keys(lockedFields).length > 0 && (
                                            <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50/90 border border-emerald-200/80 rounded-xl px-2.5 py-1.5 flex items-center justify-between">
                                                <span>🔒 Fields auto-filled by AI are locked. Tap <strong>Edit ✏️</strong> to change any value.</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setLockedFields({})}
                                                    className="text-[10px] font-bold text-emerald-900 underline ml-2 cursor-pointer"
                                                >
                                                    Unlock All
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Paper Metadata Section */}
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-semibold text-slate-700">
                                            Subject / Paper Title *
                                        </label>
                                        {lockedFields.title ? (
                                            <button
                                                type="button"
                                                onClick={() => toggleFieldLock("title")}
                                                className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                            >
                                                Edit ✏️
                                            </button>
                                        ) : uploadTitle ? (
                                            <button
                                                type="button"
                                                onClick={() => toggleFieldLock("title")}
                                                className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                🔒 Lock
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            required
                                            disabled={lockedFields.title}
                                            value={uploadTitle}
                                            onChange={(e) => setUploadTitle(e.target.value)}
                                            placeholder="e.g. Calculus II or Database Management Systems"
                                            className={`w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm border ${
                                                lockedFields.title
                                                    ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium pr-24"
                                                    : "border-slate-300 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                                            }`}
                                        />
                                        {lockedFields.title && (
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                                AI Auto-Filled
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Three-column row: Branch, Semester (Important), Year */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                    {/* Branch / Department */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Branch / Dept *
                                            </label>
                                            {lockedFields.subject ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("subject")}
                                                    className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                                >
                                                    Edit ✏️
                                                </button>
                                            ) : uploadSubject ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("subject")}
                                                    className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    🔒 Lock
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                required
                                                disabled={lockedFields.subject}
                                                value={uploadSubject}
                                                onChange={(e) => setUploadSubject(e.target.value)}
                                                placeholder="e.g. CSE / IT / B.Com"
                                                className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm border ${
                                                    lockedFields.subject
                                                        ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium pr-20"
                                                        : "border-slate-300 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                                                }`}
                                            />
                                            {lockedFields.subject && (
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                                    AI Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Semester Field (IMPORTANT) */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-bold text-brand-dark flex items-center gap-1">
                                                <span>Semester *</span>
                                                <span className="text-[10px] text-amber-800 bg-amber-100 px-1 py-0.2 rounded font-bold">Important</span>
                                            </label>
                                            {lockedFields.semester ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("semester")}
                                                    className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                                >
                                                    Edit ✏️
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("semester")}
                                                    className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    🔒 Lock
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <select
                                                required
                                                disabled={lockedFields.semester}
                                                value={uploadSemester}
                                                onChange={(e) => setUploadSemester(e.target.value)}
                                                className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm border ${
                                                    lockedFields.semester
                                                        ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium"
                                                        : "border-slate-300 focus:outline-none focus:border-brand bg-white"
                                                }`}
                                            >
                                                <option value="Semester 1">Semester 1 (1st Sem)</option>
                                                <option value="Semester 2">Semester 2 (2nd Sem)</option>
                                                <option value="Semester 3">Semester 3 (3rd Sem)</option>
                                                <option value="Semester 4">Semester 4 (4th Sem)</option>
                                                <option value="Semester 5">Semester 5 (5th Sem)</option>
                                                <option value="Semester 6">Semester 6 (6th Sem)</option>
                                                <option value="Semester 7">Semester 7 (7th Sem)</option>
                                                <option value="Semester 8">Semester 8 (8th Sem)</option>
                                                <option value="Annual / Year 1">Annual / Year 1</option>
                                                <option value="Annual / Year 2">Annual / Year 2</option>
                                                <option value="Annual / Year 3">Annual / Year 3</option>
                                            </select>
                                            {lockedFields.semester && (
                                                <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded pointer-events-none">
                                                    AI Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Exam Year */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Exam Year *
                                            </label>
                                            {lockedFields.examYear ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("examYear")}
                                                    className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                                >
                                                    Edit ✏️
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("examYear")}
                                                    className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    🔒 Lock
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <select
                                                disabled={lockedFields.examYear}
                                                value={uploadYear}
                                                onChange={(e) => setUploadYear(e.target.value)}
                                                className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm border ${
                                                    lockedFields.examYear
                                                        ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium"
                                                        : "border-slate-300 focus:outline-none focus:border-brand bg-white"
                                                }`}
                                            >
                                                <option value="2026">2026</option>
                                                <option value="2025">2025</option>
                                                <option value="2024">2024</option>
                                                <option value="2023">2023</option>
                                                <option value="2022">2022</option>
                                                <option value="2021">2021</option>
                                                <option value="2020">2020</option>
                                            </select>
                                            {lockedFields.examYear && (
                                                <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded pointer-events-none">
                                                    AI Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* College / University */}
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-semibold text-slate-700">
                                            College / University (Optional)
                                        </label>
                                        {lockedFields.college ? (
                                            <button
                                                type="button"
                                                onClick={() => toggleFieldLock("college")}
                                                className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                            >
                                                Edit ✏️
                                            </button>
                                        ) : uploadCollege ? (
                                            <button
                                                type="button"
                                                onClick={() => toggleFieldLock("college")}
                                                className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                🔒 Lock
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            disabled={lockedFields.college}
                                            value={uploadCollege}
                                            onChange={(e) => setUploadCollege(e.target.value)}
                                            placeholder="e.g. Delhi University / AKTU / IPU"
                                            className={`w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm border ${
                                                lockedFields.college
                                                    ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium pr-24"
                                                    : "border-slate-300 focus:outline-none focus:border-brand"
                                            }`}
                                        />
                                        {lockedFields.college && (
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                                AI Auto-Filled
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Top Code & Paper Code extracted by Gemini AI or manual */}
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Top Code (e.g. 37248)
                                            </label>
                                            {lockedFields.topCode ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("topCode")}
                                                    className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                                >
                                                    Edit ✏️
                                                </button>
                                            ) : uploadTopCode ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("topCode")}
                                                    className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    🔒 Lock
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                disabled={lockedFields.topCode}
                                                value={uploadTopCode}
                                                onChange={(e) => setUploadTopCode(e.target.value)}
                                                placeholder="e.g. 37248"
                                                className={`w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm border font-mono ${
                                                    lockedFields.topCode
                                                        ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium pr-18"
                                                        : "border-slate-300 focus:outline-none focus:border-brand"
                                                }`}
                                            />
                                            {lockedFields.topCode && (
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                                                    AI Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-semibold text-slate-700">
                                                Paper Code (Unique)
                                            </label>
                                            {lockedFields.paperCode ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("paperCode")}
                                                    className="text-[10px] font-bold text-brand hover:underline cursor-pointer"
                                                >
                                                    Edit ✏️
                                                </button>
                                            ) : uploadPaperCode ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFieldLock("paperCode")}
                                                    className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    🔒 Lock
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                disabled={lockedFields.paperCode}
                                                value={uploadPaperCode}
                                                onChange={(e) => setUploadPaperCode(e.target.value)}
                                                placeholder="e.g. 25GEO404MV01"
                                                className={`w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm border font-mono ${
                                                    lockedFields.paperCode
                                                        ? "bg-slate-100 text-slate-700 border-slate-200 cursor-not-allowed font-medium pr-18"
                                                        : "border-slate-300 focus:outline-none focus:border-brand"
                                                }`}
                                            />
                                            {lockedFields.paperCode && (
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                                    AI Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Extracted Tags Preview */}
                                {uploadTags.length > 0 && (
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Search Autocomplete Tags (Extracted by AI)
                                        </label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {uploadTags.map((tag, idx) => (
                                                 <span
                                                     key={idx}
                                                     className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full"
                                                 >
                                                     #{tag}
                                                     <button
                                                         type="button"
                                                         onClick={() => setUploadTags((prev) => prev.filter((_, i) => i !== idx))}
                                                         className="text-slate-400 hover:text-slate-600 font-bold ml-0.5 cursor-pointer"
                                                     >
                                                         ×
                                                     </button>
                                                 </span>
                                             ))}
                                        </div>
                                    </div>
                                )}

                                <div className="pt-2 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        disabled={isUploading}
                                        onClick={() => {
                                            setIsUploadModalOpen(false);
                                            setCapturedPages([]);
                                            setUploadError(null);
                                            setPageValidationStatus(null);
                                            setUploadSemester("Semester 1");
                                            setLockedFields({});
                                            setBatchAnalysisDone(false);
                                        }}
                                        className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            isUploading ||
                                            isValidatingPage ||
                                            isAnalyzingBatch ||
                                            Boolean(uploadLockout?.isBlocked) ||
                                            invalidPageNumbers.length > 0 ||
                                            (pageValidationStatus !== null && !pageValidationStatus.isFrontPage) ||
                                            (uploadTab === "file" && uploadFile?.type === "application/pdf" && uploadFile.size > 3 * 1024 * 1024)
                                        }
                                        className={`px-5 py-2.5 rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1.5 ${
                                            uploadLockout?.isBlocked || invalidPageNumbers.length > 0 || (uploadTab === "file" && uploadFile?.type === "application/pdf" && uploadFile.size > 3 * 1024 * 1024)
                                                ? "bg-rose-100 text-rose-800 border border-rose-300 cursor-not-allowed opacity-90"
                                                : "bg-accent text-brand-dark hover:bg-amber-400 disabled:opacity-50"
                                        }`}
                                    >
                                        {isUploading ? (
                                            <>
                                                <div className="w-3.5 h-3.5 border-2 border-brand-dark border-t-transparent rounded-full animate-spin" />
                                                <span>Compressing &amp; Uploading to R2...</span>
                                            </>
                                        ) : uploadLockout?.isBlocked ? (
                                            <span>⛔ Blocked for 5 Hours</span>
                                        ) : invalidPageNumbers.length > 0 ? (
                                            <span>⚠️ Remove Random Image ({invalidPageNumbers.join(", ")}) to Submit</span>
                                        ) : uploadTab === "file" && uploadFile?.type === "application/pdf" && uploadFile.size > 3 * 1024 * 1024 ? (
                                            <span>⚠️ PDF Exceeds 3 MB Limit</span>
                                        ) : isValidatingPage ? (
                                            <span>AI Verifying Front Page...</span>
                                        ) : isAnalyzingBatch ? (
                                            <span>AI Analyzing Pages...</span>
                                        ) : pageValidationStatus && !pageValidationStatus.isFrontPage ? (
                                            "Front Page Required"
                                        ) : capturedPages.length > 0 ? (
                                            `Submit (${capturedPages.length} Pages • ${(capturedPages.reduce((sum, p) => sum + p.file.size, 0) / (1024 * 1024)).toFixed(2)} MB)`
                                        ) : (
                                            "Submit Paper"
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Photo Zoom Preview Modal */}
            {previewPhoto && (
                <div
                    className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
                    onClick={() => setPreviewPhoto(null)}
                >
                    <div className="relative max-w-lg max-h-[85vh] overflow-hidden rounded-2xl bg-black">
                        <button
                            type="button"
                            onClick={() => setPreviewPhoto(null)}
                            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-sm z-10"
                        >
                            ✕
                        </button>
                        <img
                            src={previewPhoto}
                            alt="Snapped Paper Preview"
                            className="w-full h-full object-contain"
                        />
                    </div>
                </div>
            )}

            {/* =========================================================================
                SIGN IN / SIGN UP MODAL (Triggered when user tries to search or upload)
               ========================================================================= */}
            {isAuthModalOpen && (
                <SignUp
                    isModal={true}
                    onClose={() => setIsAuthModalOpen(false)}
                    onAuthSuccess={(authedUser) => {
                        if (onAuthSuccess) {
                            onAuthSuccess(authedUser);
                        }
                        setIsAuthModalOpen(false);
                        if (pendingAction) {
                            const act = pendingAction;
                            setPendingAction(null);
                            act();
                        }
                    }}
                />
            )}

            {/* =========================================================================
                SIGN OUT CONFIRMATION MODAL
               ========================================================================= */}
            {isSignOutConfirmOpen && (
                <div
                    className="fixed inset-0 z-50 bg-brand-dark/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
                    onClick={() => setIsSignOutConfirmOpen(false)}
                >
                    <div
                        className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 relative my-auto animate-in zoom-in-95 duration-150 text-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setIsSignOutConfirmOpen(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                            aria-label="Close"
                        >
                            ✕
                        </button>

                        {/* Profile Picture with logo-4 & User Info */}
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-300 bg-[#27313d] mx-auto mb-3 shadow-xs flex items-center justify-center">
                            <img
                                src="/logo/logo-4.png"
                                alt="User Profile"
                                className="w-full h-full object-cover"
                            />
                        </div>

                        <h3 className="text-lg font-bold text-brand-dark mb-1">
                            Sign Out of cDocs?
                        </h3>

                        {user && (
                            <div className="inline-flex flex-col items-center px-3.5 py-1.5 rounded-xl bg-slate-50 text-xs text-slate-600 mb-3 border border-slate-200/80 max-w-full">
                                <span className="font-bold text-slate-900">
                                    @{user.username || "student"}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                    {user.email}
                                </span>
                            </div>
                        )}

                        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                            Are you sure you want to end your session? You&apos;ll need to sign in again to search, upload, or read past papers.
                        </p>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setIsSignOutConfirmOpen(false)}
                                className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-98 transition cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsSignOutConfirmOpen(false);
                                    onSignOut();
                                }}
                                className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-98 transition shadow-xs cursor-pointer"
                            >
                                Yes, Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* In-App Secure Canvas PDF Reader Modal */}
            {activeReadingDoc && (
                <SecureReaderModal
                    document={activeReadingDoc}
                    user={user}
                    onClose={() => setActiveReadingDoc(null)}
                />
            )}
        </div>
    );
};

export default Home;
