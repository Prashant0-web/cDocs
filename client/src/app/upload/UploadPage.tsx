import React, { useState, useRef, useEffect } from "react";
import { Navbar } from "../../components/Navbar";
import { uploadMultipart } from "../../services/api.service";
import { ContinuousScannerModal } from "../../components/ContinuousScannerModal";
import type { StoredUser } from "../../utils/cookie.util";
import {
    type CapturedPage,
    computeFileSha256,
    computeImagePerceptualHash,
    calculateDHashDistance,
    compressImageForUpload,
} from "../../utils/upload.util";

interface UploadPageProps {
    user: StoredUser | null;
    onNavigateHome: () => void;
    onNavigatePaper?: (paperId: string) => void;
    onRequestAuth?: (reason?: string) => void;
    onSignOut: () => void;
}

export const UploadPage: React.FC<UploadPageProps> = ({
    user,
    onNavigateHome,
    onNavigatePaper,
    onRequestAuth,
    onSignOut,
}) => {
    // Mode switcher: "camera" for snapping multiple pages vs "file" for PDF/single doc
    const [uploadTab, setUploadTab] = useState<"camera" | "file">("camera");

    // Live continuous camera modal state
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    // File / Captured Pages state
    const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const systemCameraInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form inputs state
    const [uploadTitle, setUploadTitle] = useState("");
    const [uploadSubject, setUploadSubject] = useState("");
    const [uploadCollege, setUploadCollege] = useState("");
    const [uploadCourse, setUploadCourse] = useState("");
    const [uploadSemester, setUploadSemester] = useState("Semester 1");
    const [uploadYear, setUploadYear] = useState("2024");
    const [uploadExamType, setUploadExamType] = useState("end-sem");
    const [uploadTopCode, setUploadTopCode] = useState("");
    const [uploadPaperCode, setUploadPaperCode] = useState("");
    const [uploadTags, setUploadTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");

    // AI Auto-Fill & Validation States
    const [isValidatingPage, setIsValidatingPage] = useState(false);
    const [aiFilledFields, setAiFilledFields] = useState<Record<string, boolean>>({});
    const [pageValidationStatus, setPageValidationStatus] = useState<{
        checked: boolean;
        isFrontPage: boolean;
        indicatorsFound: string[];
        message?: string;
    } | null>(null);

    // Anti-Abuse & Non-Academic lock states
    const [invalidPageNumbers, setInvalidPageNumbers] = useState<number[]>([]);
    const [invalidPageReasons, setInvalidPageReasons] = useState<Record<number, string>>({});
    const [uploadLockout, setUploadLockout] = useState<{
        isBlocked: boolean;
        blockedUntil?: string;
        message?: string;
    } | null>(null);

    // Upload progress & result state
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
    const [uploadDetails, setUploadDetails] = useState<{
        savingsPercent?: string;
        totalPages?: number;
    } | null>(null);

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
                }
            } catch {
                localStorage.removeItem("cdocs_upload_lockout");
            }
        }
    }, []);

    // Front page AI validation & auto-fill without locking
    const validateFirstUploadedPage = async (pageFile: File) => {
        if (!pageFile) return;
        setIsValidatingPage(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append("file", pageFile);

            const response = await uploadMultipart<{
                success: boolean;
                data: {
                    isFrontPage: boolean;
                    indicatorsFound: string[];
                    message?: string;
                    isNonAcademic?: boolean;
                    nonAcademicReason?: string;
                    topCode?: string;
                    paperCode?: string;
                    title?: string;
                    subject?: string;
                    college?: string;
                    semester?: string;
                    examYear?: string;
                    tags?: string[];
                };
            }>("/documents/validate-page", formData);

            if (response?.data) {
                const result = response.data;
                setPageValidationStatus({
                    checked: true,
                    isFrontPage: result.isFrontPage,
                    indicatorsFound: result.indicatorsFound || [],
                    message: result.message,
                });

                if (result.isNonAcademic) {
                    setInvalidPageNumbers((prev) => Array.from(new Set([...prev, 1])));
                    setInvalidPageReasons((prev) => ({
                        ...prev,
                        1: result.nonAcademicReason || "Non-academic content detected",
                    }));
                }

                // Auto-fill fields immediately without locking
                const newlyFilled: Record<string, boolean> = {};

                if (result.title) {
                    setUploadTitle(result.title);
                    newlyFilled.title = true;
                }
                if (result.subject) {
                    setUploadSubject(result.subject);
                    newlyFilled.subject = true;
                }
                if (result.semester) {
                    setUploadSemester(result.semester);
                    newlyFilled.semester = true;
                }
                if (result.examYear) {
                    setUploadYear(result.examYear);
                    newlyFilled.examYear = true;
                }
                if (result.college) {
                    setUploadCollege(result.college);
                    newlyFilled.college = true;
                }
                if (result.topCode) {
                    setUploadTopCode(result.topCode);
                    newlyFilled.topCode = true;
                }
                if (result.paperCode) {
                    setUploadPaperCode(result.paperCode);
                    newlyFilled.paperCode = true;
                }
                if (Array.isArray(result.tags) && result.tags.length > 0) {
                    setUploadTags(result.tags);
                    newlyFilled.tags = true;
                }
                setAiFilledFields(newlyFilled);

                if (!result.isFrontPage) {
                    setUploadError("Notice: The uploaded page may not be the front cover. Please verify the paper details.");
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

    // Camera capture handler with client-side compression and anti-duplicate check
    const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const incomingFiles = Array.from(e.target.files);

        const uniquePages: CapturedPage[] = [];
        let duplicateReason: string | null = null;

        for (let i = 0; i < incomingFiles.length; i++) {
            const rawFile = incomingFiles[i];
            if (!rawFile) continue;

            const file = await compressImageForUpload(rawFile);

            try {
                const sha256 = await computeFileSha256(file);
                const dHash = await computeImagePerceptualHash(file);

                const isExactDuplicate =
                    capturedPages.some((p) => p.hash === sha256 || (p.file.size === file.size && p.file.name === file.name)) ||
                    uniquePages.some((u) => u.hash === sha256);

                if (isExactDuplicate) {
                    duplicateReason = "Duplicate image detected! You cannot add the exact same photo twice.";
                    continue;
                }

                if (dHash) {
                    const visualDuplicate =
                        capturedPages.find((p) => p.dHash && calculateDHashDistance(p.dHash, dHash) <= 24) ||
                        uniquePages.find((u) => u.dHash && calculateDHashDistance(u.dHash, dHash) <= 24);

                    if (visualDuplicate) {
                        duplicateReason = `Duplicate image detected! This photo is virtually identical to ${visualDuplicate.name}. Please flip the page for the next question.`;
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
            } catch {
                uniquePages.push({
                    id: `${Date.now()}-${i}`,
                    url: URL.createObjectURL(file),
                    file,
                    name: `Page ${capturedPages.length + uniquePages.length + 1}`,
                });
            }
        }

        if (duplicateReason) {
            setUploadError(duplicateReason);
        }

        if (uniquePages.length > 0) {
            setCapturedPages((prev) => {
                const updated = [...prev, ...uniquePages];
                if (prev.length === 0 && updated.length > 0) {
                    validateFirstUploadedPage(updated[0].file);
                }
                return updated;
            });
        }

        if (e.target) {
            e.target.value = "";
        }
    };

    const handleScannerBatchComplete = (newPages: CapturedPage[]) => {
        if (!newPages || newPages.length === 0) return;
        setCapturedPages((prev) => {
            const updated = [...prev, ...newPages];
            if (prev.length === 0 && updated.length > 0) {
                validateFirstUploadedPage(updated[0].file);
            }
            return updated;
        });
    };

    const handleRemovePage = (indexToRemove: number) => {
        setCapturedPages((prev) => {
            const pageToRemove = prev[indexToRemove];
            if (pageToRemove?.url) {
                URL.revokeObjectURL(pageToRemove.url);
            }
            const updated = prev.filter((_, idx) => idx !== indexToRemove);

            if (indexToRemove === 0 && updated.length > 0) {
                validateFirstUploadedPage(updated[0].file);
            } else if (updated.length === 0) {
                setPageValidationStatus(null);
                setAiFilledFields({});
            }

            const removedPageNum = indexToRemove + 1;
            setInvalidPageNumbers((prevInv) =>
                prevInv.filter((p) => p !== removedPageNum).map((p) => (p > removedPageNum ? p - 1 : p))
            );
            return updated;
        });
    };

    const handleFileChange = async (file: File | null) => {
        if (!file) {
            setUploadFile(null);
            setPageValidationStatus(null);
            return;
        }

        if (file.type === "application/pdf" && file.size > 3 * 1024 * 1024) {
            const mb = (file.size / (1024 * 1024)).toFixed(2);
            setUploadError(`PDF size (${mb} MB) exceeds the 3 MB limit. Please select a smaller PDF.`);
            setUploadFile(null);
            return;
        }

        let processedFile = file;
        if (file.type.startsWith("image/")) {
            processedFile = await compressImageForUpload(file);
        }

        setUploadFile(processedFile);
        setUploadError(null);
        validateFirstUploadedPage(processedFile);
    };

    const handleAddTag = () => {
        const clean = tagInput.trim().replace(/^#+/, "");
        if (clean && !uploadTags.includes(clean)) {
            setUploadTags([...uploadTags, clean]);
            setTagInput("");
        }
    };

    const handleRemoveTag = (tag: string) => {
        setUploadTags(uploadTags.filter((t) => t !== tag));
    };

    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 1. Abuse lockout check
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

        // 2. Non-academic check
        if (invalidPageNumbers.length > 0) {
            const reasons = invalidPageNumbers
                .map((n) => `Page ${n}: ${invalidPageReasons[n] || "Invalid / non-academic image"}`)
                .join("; ");
            setUploadError(
                `Please remove non-academic image(s) before submitting: ${reasons}`
            );
            return;
        }

        // 3. Validation checks
        if (!uploadTitle.trim() || !uploadSubject.trim()) {
            setUploadError("Please provide both paper title and subject/department.");
            return;
        }

        const hasCameraPages = uploadTab === "camera" && capturedPages.length > 0;
        const hasFile = uploadTab === "file" && uploadFile !== null;

        if (!hasCameraPages && !hasFile) {
            setUploadError("Please capture at least 1 page photo or choose a PDF file.");
            return;
        }

        setIsUploading(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append("title", uploadTitle.trim());
            formData.append("subject", uploadSubject.trim());
            formData.append("semester", uploadSemester.trim());
            formData.append("examYear", uploadYear);
            formData.append("examType", uploadExamType);

            if (uploadCollege.trim()) formData.append("college", uploadCollege.trim());
            if (uploadCourse.trim()) formData.append("course", uploadCourse.trim());
            if (uploadTopCode.trim()) formData.append("topCode", uploadTopCode.trim());
            if (uploadPaperCode.trim()) formData.append("paperCode", uploadPaperCode.trim());
            if (uploadTags.length > 0) formData.append("tags", uploadTags.join(","));

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
                totalPages: response?.data?.totalPages,
            });

            const newDocId = response?.data?.document?._id || response?.data?.document?.id || response?.data?._id;
            if (newDocId) {
                setUploadedDocId(String(newDocId));
            }

            setUploadSuccess(true);
        } catch (err: any) {
            console.error("Upload error:", err);
            setUploadError(err?.message || "Failed to upload question paper. Please check connection and try again.");
        } finally {
            setIsUploading(false);
        }
    };

    const resetUploadForm = () => {
        setUploadSuccess(false);
        setUploadedDocId(null);
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
        setAiFilledFields({});
        setUploadError(null);
    };

    return (
        <div className="min-h-screen bg-brand-light/30 text-slate-800 flex flex-col font-sans selection:bg-accent/40 selection:text-brand-dark">
            <Navbar
                user={user}
                onSignOut={onSignOut}
                onRequestAuth={onRequestAuth}
            />

            <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
                {/* Back navigation button */}
                <div className="flex items-center justify-between mb-5">
                    <button
                        type="button"
                        onClick={onNavigateHome}
                        className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-brand-dark transition-colors cursor-pointer group"
                    >
                        <span className="p-1 rounded-lg bg-white border border-slate-200 group-hover:border-slate-300">
                            ←
                        </span>
                        <span>Back to Question Papers</span>
                    </button>

                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/20 border border-accent/40 text-[11px] font-bold text-brand-dark">
                        <span>✨</span>
                        <span>Gemini AI Auto-Fill Enabled</span>
                    </div>
                </div>

                {/* Page Heading Card */}
                <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm mb-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold mb-2.5">
                                <span>📤</span>
                                <span>Contribute to Student Community</span>
                            </div>
                            <h1 className="text-xl sm:text-3xl font-extrabold text-brand-dark tracking-tight">
                                Upload Past Year Question Paper
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed max-w-2xl">
                                Snap photos of the pages or upload a PDF. Our AI automatically reads the front page to fill in the subject, codes, and semester.
                            </p>
                        </div>
                    </div>
                </div>

                {/* 5-Hour Abuse Lockout Alert Banner */}
                {uploadLockout?.isBlocked && (
                    <div className="p-5 rounded-3xl bg-rose-50 border-2 border-rose-300 text-xs text-rose-900 space-y-2 mb-6 shadow-sm">
                        <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                            <span>⛔</span>
                            <span>Upload Temporarily Blocked for 5 Hours</span>
                        </div>
                        <p className="text-xs text-rose-800 leading-relaxed font-medium">
                            {uploadLockout.message || "Multiple attempts with non-academic or random images detected. Upload access has been temporarily blocked for 5 hours."}
                        </p>
                    </div>
                )}

                {/* Upload Success Celebration Screen */}
                {uploadSuccess ? (
                    <div className="bg-white rounded-3xl p-8 sm:p-12 border border-emerald-200 shadow-lg text-center space-y-5 animate-in fade-in zoom-in-95">
                        <div className="w-16 h-16 rounded-3xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center text-3xl mx-auto shadow-sm">
                            🎉
                        </div>
                        <div>
                            <h2 className="text-xl sm:text-2xl font-extrabold text-brand-dark">
                                Paper Uploaded Successfully!
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto mt-2">
                                Your question paper has been compressed for crystal-clear readability and securely indexed for students.
                            </p>
                        </div>

                        {uploadDetails?.savingsPercent && (
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-50 text-emerald-800 rounded-full text-xs font-bold border border-emerald-200 shadow-xs">
                                <span>⚡</span>
                                <span>Storage Saved: {uploadDetails.savingsPercent} (Lossless Compression)</span>
                                <span>•</span>
                                <span>{uploadDetails.totalPages || 1} Pages</span>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
                            {uploadedDocId && onNavigatePaper && (
                                <button
                                    type="button"
                                    onClick={() => onNavigatePaper(uploadedDocId)}
                                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs sm:text-sm font-semibold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2"
                                >
                                    <span>View Paper Details &amp; Reviews</span>
                                    <span>➔</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={resetUploadForm}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-accent hover:bg-amber-400 text-brand-dark text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer"
                            >
                                Upload Another Paper 📤
                            </button>

                            <button
                                type="button"
                                onClick={onNavigateHome}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-all cursor-pointer"
                            >
                                Back to All Papers
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleUploadSubmit} className="space-y-6">
                        {/* Error Banner */}
                        {uploadError && (
                            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2.5">
                                <span className="text-base shrink-0">⚠️</span>
                                <div className="flex-1">{uploadError}</div>
                                <button
                                    type="button"
                                    onClick={() => setUploadError(null)}
                                    className="text-rose-400 hover:text-rose-600 font-bold"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* SECTION 1: Page Photos / PDF Input */}
                        <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                                <div>
                                    <h3 className="text-sm sm:text-base font-bold text-brand-dark flex items-center gap-2">
                                        <span>Step 1: Document Pages</span>
                                        <span className="text-[10px] font-extrabold uppercase bg-brand-light text-brand px-2 py-0.5 rounded-full border border-slate-200">
                                            Required
                                        </span>
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Capture multi-page paper photos or upload an existing PDF file.
                                    </p>
                                </div>

                                {/* Mode Switcher Tabs */}
                                <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 self-start sm:self-auto">
                                    <button
                                        type="button"
                                        onClick={() => setUploadTab("camera")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                            uploadTab === "camera"
                                                ? "bg-white text-brand-dark shadow-xs"
                                                : "text-slate-500 hover:text-slate-800"
                                        }`}
                                    >
                                        <span>📸</span>
                                        <span>Snap Photos ({capturedPages.length})</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setUploadTab("file")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                            uploadTab === "file"
                                                ? "bg-white text-brand-dark shadow-xs"
                                                : "text-slate-500 hover:text-slate-800"
                                        }`}
                                    >
                                        <span>📁</span>
                                        <span>Upload PDF</span>
                                    </button>
                                </div>
                            </div>

                            {/* Camera Capture Mode */}
                            {uploadTab === "camera" && (
                                <div className="space-y-4">
                                    {/* Gallery / Photos Input (NO capture attribute -> Opens Photo Gallery / File Manager) */}
                                    <input
                                        ref={galleryInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={handleCameraCapture}
                                    />

                                    {/* Native Camera App Input (capture="environment" -> Opens System Camera App fallback) */}
                                    <input
                                        ref={systemCameraInputRef}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        multiple
                                        className="hidden"
                                        onChange={handleCameraCapture}
                                    />

                                    {/* Action Cards: Live Continuous Camera Scanner (Primary) + Gallery Picker */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                        {/* Primary: Continuous Multi-Page Camera Scanner */}
                                        <div
                                            onClick={() => setIsScannerOpen(true)}
                                            className="border-2 border-accent bg-accent/15 hover:bg-accent/25 rounded-2xl p-5 sm:p-6 text-center cursor-pointer transition-all active:scale-[0.99] group flex flex-col items-center justify-between gap-3 shadow-xs"
                                        >
                                            <div className="w-13 h-13 rounded-2xl bg-accent text-brand-dark flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-sm">
                                                📸
                                            </div>
                                            <div>
                                                <div className="text-sm font-extrabold text-brand-dark flex items-center justify-center gap-1.5">
                                                    <span>Live Continuous Scanner</span>
                                                    <span className="text-[10px] font-black uppercase bg-emerald-500 text-white px-2 py-0.2 rounded-full">
                                                        Rapid
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-600 mt-1 max-w-xs leading-relaxed">
                                                    Keep camera open! Snap Page 1, Page 2, Page 3 continuously in rapid succession.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setIsScannerOpen(true);
                                                }}
                                                className="px-4 py-2 rounded-xl bg-brand-dark text-white text-xs font-bold shadow-xs cursor-pointer group-hover:bg-brand"
                                            >
                                                Open Live Camera ➔
                                            </button>
                                        </div>

                                        {/* Secondary: Pick photos from gallery / device */}
                                        <div
                                            onClick={() => galleryInputRef.current?.click()}
                                            className="border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100/80 rounded-2xl p-5 sm:p-6 text-center cursor-pointer transition-all active:scale-[0.99] group flex flex-col items-center justify-between gap-3"
                                        >
                                            <div className="w-13 h-13 rounded-2xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform shadow-2xs">
                                                🖼️
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold text-slate-800">
                                                    Upload from Gallery / Files
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-1 max-w-xs leading-relaxed">
                                                    Already have photos? Select multiple photos from your device storage/gallery.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        galleryInputRef.current?.click();
                                                    }}
                                                    className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
                                                >
                                                    Open Gallery 🖼️
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        systemCameraInputRef.current?.click();
                                                    }}
                                                    className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                                                    title="Use native phone camera app"
                                                >
                                                    Phone Camera 📱
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Captured Pages Grid */}
                                    {capturedPages.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 px-1">
                                                <span>Captured Pages ({capturedPages.length})</span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsScannerOpen(true)}
                                                        className="text-xs font-bold text-brand hover:underline cursor-pointer flex items-center gap-1"
                                                    >
                                                        <span>📸 Scan Next Page</span>
                                                    </button>
                                                    <span className="text-slate-300">|</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => galleryInputRef.current?.click()}
                                                        className="text-xs font-bold text-brand hover:underline cursor-pointer flex items-center gap-1"
                                                    >
                                                        <span>🖼️ From Gallery</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                                {capturedPages.map((page, idx) => (
                                                    <div
                                                        key={page.id}
                                                        className="relative rounded-xl overflow-hidden border border-slate-200 bg-white shadow-2xs group aspect-[3/4] flex flex-col justify-between p-1.5"
                                                    >
                                                        <img
                                                            src={page.url}
                                                            alt={`Page ${idx + 1}`}
                                                            className="w-full h-full object-cover rounded-lg"
                                                        />
                                                        <div className="absolute top-2 left-2 bg-brand-dark/80 backdrop-blur-xs text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-2xs">
                                                            {idx === 0 ? "Page 1 (Front)" : `Page ${idx + 1}`}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemovePage(idx);
                                                            }}
                                                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs flex items-center justify-center shadow-md cursor-pointer transition-transform hover:scale-110"
                                                            title="Delete Page"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* File Upload Mode (PDF / Single Doc) */}
                            {uploadTab === "file" && (
                                <div className="space-y-3">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0] || null;
                                            handleFileChange(f);
                                        }}
                                    />

                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="border-2 border-dashed border-slate-200 hover:border-brand/50 rounded-2xl p-6 sm:p-8 text-center bg-slate-50/50 hover:bg-slate-50 transition-all cursor-pointer group flex flex-col items-center justify-center gap-2"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform shadow-2xs">
                                            📄
                                        </div>
                                        <div className="text-xs sm:text-sm font-bold text-brand-dark group-hover:text-brand">
                                            {uploadFile ? uploadFile.name : "Select or Drop PDF / Question Paper Document"}
                                        </div>
                                        <p className="text-[11px] text-slate-500 max-w-sm">
                                            PDF or image files up to 3 MB. We optimize the document for ultra-fast reading.
                                        </p>
                                    </div>

                                    {uploadFile && (
                                        <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200 flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-base">📄</span>
                                                <span className="text-xs font-bold text-brand-dark truncate">
                                                    {uploadFile.name}
                                                </span>
                                                <span className="text-[10px] text-slate-500">
                                                    ({(uploadFile.size / 1024).toFixed(0)} KB)
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setUploadFile(null);
                                                    setPageValidationStatus(null);
                                                    setAiFilledFields({});
                                                }}
                                                className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 cursor-pointer"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* AI Validation Status Banner */}
                            {isValidatingPage && (
                                <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2 animate-pulse">
                                    <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>Gemini Vision is analyzing the front page &amp; auto-filling details...</span>
                                </div>
                            )}

                            {pageValidationStatus && !isValidatingPage && (
                                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <span>✨</span>
                                        <span className="font-bold">Front Page Identified!</span>
                                        <span className="text-[11px] text-emerald-800">
                                            Details auto-filled below. You can edit any field.
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* SECTION 2: Paper Details Form (Responsive 2-column Grid) */}
                        <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-sm space-y-4">
                            <div className="border-b border-slate-100 pb-3">
                                <h3 className="text-sm sm:text-base font-bold text-brand-dark flex items-center gap-2">
                                    <span>Step 2: Paper Details &amp; Metadata</span>
                                    {Object.keys(aiFilledFields).length > 0 && (
                                        <span className="text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-full border border-indigo-200">
                                            ✨ {Object.keys(aiFilledFields).length} Fields Auto-Filled
                                        </span>
                                    )}
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Help students find this paper by providing accurate university and course details.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Title (Span 2) */}
                                <div className="sm:col-span-2">
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        Document Title *
                                        {aiFilledFields.title && (
                                            <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                                ✨ AI Auto-Filled
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={uploadTitle}
                                        onChange={(e) => setUploadTitle(e.target.value)}
                                        placeholder="e.g. Data Structures & Algorithms Endsem 2024"
                                        className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all ${
                                            aiFilledFields.title
                                                ? "border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-200/60"
                                                : "border-slate-300 bg-white"
                                        }`}
                                    />
                                </div>

                                {/* Subject */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        Subject / Branch *
                                        {aiFilledFields.subject && (
                                            <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                                ✨ AI
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={uploadSubject}
                                        onChange={(e) => setUploadSubject(e.target.value)}
                                        placeholder="e.g. Computer Science / Mathematics"
                                        className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all ${
                                            aiFilledFields.subject
                                                ? "border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-200/60"
                                                : "border-slate-300 bg-white"
                                        }`}
                                    />
                                </div>

                                {/* Semester */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        Semester *
                                        {aiFilledFields.semester && (
                                            <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                                ✨ AI
                                            </span>
                                        )}
                                    </label>
                                    <select
                                        value={uploadSemester}
                                        onChange={(e) => setUploadSemester(e.target.value)}
                                        className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all ${
                                            aiFilledFields.semester
                                                ? "border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-200/60"
                                                : "border-slate-300 bg-white"
                                        }`}
                                    >
                                        <option value="Semester 1">Semester 1</option>
                                        <option value="Semester 2">Semester 2</option>
                                        <option value="Semester 3">Semester 3</option>
                                        <option value="Semester 4">Semester 4</option>
                                        <option value="Semester 5">Semester 5</option>
                                        <option value="Semester 6">Semester 6</option>
                                        <option value="Semester 7">Semester 7</option>
                                        <option value="Semester 8">Semester 8</option>
                                    </select>
                                </div>

                                {/* College / University */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        College / University
                                        {aiFilledFields.college && (
                                            <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                                ✨ AI
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        value={uploadCollege}
                                        onChange={(e) => setUploadCollege(e.target.value)}
                                        placeholder="e.g. Pune University, Delhi University"
                                        className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all ${
                                            aiFilledFields.college
                                                ? "border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-200/60"
                                                : "border-slate-300 bg-white"
                                        }`}
                                    />
                                </div>

                                {/* Course / Degree */}
                                <div>
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        Course / Degree
                                    </label>
                                    <input
                                        type="text"
                                        value={uploadCourse}
                                        onChange={(e) => setUploadCourse(e.target.value)}
                                        placeholder="e.g. B.Tech, B.Sc, BCA, MBA"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
                                    />
                                </div>

                                {/* Exam Year & Exam Type */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1">Year</label>
                                        <select
                                            value={uploadYear}
                                            onChange={(e) => setUploadYear(e.target.value)}
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/20"
                                        >
                                            <option value="2026">2026</option>
                                            <option value="2025">2025</option>
                                            <option value="2024">2024</option>
                                            <option value="2023">2023</option>
                                            <option value="2022">2022</option>
                                            <option value="2021">2021</option>
                                            <option value="2020">2020</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1">Exam Type</label>
                                        <select
                                            value={uploadExamType}
                                            onChange={(e) => setUploadExamType(e.target.value)}
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/20"
                                        >
                                            <option value="end-sem">End-Sem</option>
                                            <option value="mid-sem">Mid-Sem</option>
                                            <option value="quiz">Quiz</option>
                                            <option value="notes">Notes</option>
                                            <option value="assignment">Assignment</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Top Code & Paper Code */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1">
                                            Top / Sub Code
                                            {aiFilledFields.topCode && <span className="text-[10px] text-indigo-600 ml-1">✨</span>}
                                        </label>
                                        <input
                                            type="text"
                                            value={uploadTopCode}
                                            onChange={(e) => setUploadTopCode(e.target.value)}
                                            placeholder="e.g. 37248"
                                            className={`w-full px-3 py-2.5 rounded-xl border text-xs text-brand-dark font-mono focus:outline-none focus:ring-2 focus:ring-brand/20 ${
                                                aiFilledFields.topCode ? "border-indigo-400 bg-indigo-50/20" : "border-slate-300"
                                            }`}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1">
                                            Paper Code
                                            {aiFilledFields.paperCode && <span className="text-[10px] text-indigo-600 ml-1">✨</span>}
                                        </label>
                                        <input
                                            type="text"
                                            value={uploadPaperCode}
                                            onChange={(e) => setUploadPaperCode(e.target.value)}
                                            placeholder="e.g. 25GEO404"
                                            className={`w-full px-3 py-2.5 rounded-xl border text-xs text-brand-dark font-mono focus:outline-none focus:ring-2 focus:ring-brand/20 ${
                                                aiFilledFields.paperCode ? "border-indigo-400 bg-indigo-50/20" : "border-slate-300"
                                            }`}
                                        />
                                    </div>
                                </div>

                                {/* Tags Input (Span 2) */}
                                <div className="sm:col-span-2">
                                    <label className="block text-xs font-bold text-brand-dark mb-1">
                                        Tags / Keywords (Press Enter or click Add)
                                    </label>
                                    <div className="flex items-center gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddTag();
                                                }
                                            }}
                                            placeholder="Add tag (e.g. Calculus, CSE, Midsem)"
                                            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddTag}
                                            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-brand-dark transition-colors cursor-pointer"
                                        >
                                            + Add
                                        </button>
                                    </div>

                                    {/* Selected Tags list */}
                                    {uploadTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            {uploadTags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 text-[11px] font-semibold border border-slate-200"
                                                >
                                                    #{tag}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveTag(tag)}
                                                        className="text-slate-400 hover:text-rose-600 font-bold ml-1 cursor-pointer"
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Submit Button Bar */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="text-xs text-slate-500 text-center sm:text-left">
                                All documents are compressed losslessly &amp; securely protected.
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={onNavigateHome}
                                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUploading}
                                    className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-75 text-white text-xs sm:text-sm font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            <span>Compressing &amp; Uploading...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Publish Question Paper</span>
                                            <span>📤</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </main>

            {/* Continuous Rapid Multi-Page Camera Scanner */}
            <ContinuousScannerModal
                isOpen={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onCompleteBatch={handleScannerBatchComplete}
                onSwitchToFilePicker={() => {
                    setIsScannerOpen(false);
                    galleryInputRef.current?.click();
                }}
                onSwitchToSystemCamera={() => {
                    setIsScannerOpen(false);
                    systemCameraInputRef.current?.click();
                }}
            />
        </div>
    );
};

export default UploadPage;
