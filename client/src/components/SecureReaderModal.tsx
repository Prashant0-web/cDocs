import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { StoredUser } from "../utils/cookie.util";
import { apiClient } from "../services/api.service";


// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface SecureReaderDoc {
    id: string;
    title: string;
    subject?: string;
    course?: string;
    semester?: string;
    year?: string;
    totalPages?: number;
}

interface SecureReaderModalProps {
    document: SecureReaderDoc;
    user: StoredUser | null;
    onClose: () => void;
}

export const SecureReaderModal: React.FC<SecureReaderModalProps> = ({
    document: docItem,
    user,
    onClose,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [scale, setScale] = useState<number>(1.2);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // DRM / Screen capture blackout state
    const [isScreenProtected, setIsScreenProtected] = useState<boolean>(false);

    // 1. Fetch document binary directly into memory without exposing Cloudflare R2 links
    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        setErrorMessage(null);

        const loadDocumentData = async () => {
            try {
                // Fetch raw arraybuffer directly from backend using unified apiClient
                const response = await apiClient.get<ArrayBuffer>(`/documents/view/${docItem.id}`, {
                    responseType: "arraybuffer",
                    timeout: 45000,
                });

                if (!isMounted) return;

                const rawHeader = response.headers ? response.headers["content-type"] : "";
                const contentType: string = typeof rawHeader === "string" ? rawHeader : String(rawHeader || "");

                if (contentType.includes("pdf")) {
                    const loadingTask = pdfjsLib.getDocument({
                        data: new Uint8Array(response.data),
                    });
                    const loadedPdf = await loadingTask.promise;
                    if (!isMounted) return;
                    setPdfDoc(loadedPdf);
                    setTotalPages(loadedPdf.numPages);
                    setCurrentPage(1);
                } else if (contentType.includes("image")) {
                    const blob = new Blob([response.data], { type: contentType });
                    const blobUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        if (!isMounted || !canvasRef.current) return;
                        const canvas = canvasRef.current;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) return;
                        canvas.width = img.width * scale;
                        canvas.height = img.height * scale;
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        // Watermark overlay: clean 'cDocs' watermark without username or email
                        const watermarkText = "cDocs";
                        ctx.save();
                        ctx.globalAlpha = 0.14;
                        ctx.font = "bold 20px sans-serif";
                        ctx.fillStyle = "#1e293b";
                        for (let x = -canvas.width; x < canvas.width * 2; x += 220) {
                            for (let y = -canvas.height; y < canvas.height * 2; y += 140) {
                                ctx.save();
                                ctx.translate(x, y);
                                ctx.rotate(-0.45);
                                ctx.fillText(watermarkText, 0, 0);
                                ctx.restore();
                            }
                        }
                        ctx.restore();
                        URL.revokeObjectURL(blobUrl);
                    };
                    img.src = blobUrl;
                    setTotalPages(1);
                    setCurrentPage(1);
                } else {
                    // Fallback for unexpected binary
                    setErrorMessage("Unsupported document format for in-app secure viewer.");
                }
            } catch (err: any) {
                console.error("[Secure Viewer] Error loading document:", err);
                if (isMounted) {
                    setErrorMessage(
                        err?.response?.data?.message ||
                        "Failed to load protected document. Please try again."
                    );
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        loadDocumentData();

        return () => {
            isMounted = false;
        };
    }, [docItem.id]);

    // 2. Render current page on HTML <canvas> with watermark
    const renderPage = useCallback(
        async (pageNumber: number) => {
            if (!pdfDoc || !canvasRef.current) return;

            try {
                const page = await pdfDoc.getPage(pageNumber);
                const viewport = page.getViewport({ scale });
                const canvas = canvasRef.current;
                const context = canvas.getContext("2d");

                if (!context) return;

                // Set canvas dimensions
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport,
                };

                await page.render(renderContext).promise;

                // 3. Document Watermark Layer: clean 'cDocs' watermark
                const watermarkText = "cDocs";

                context.save();
                context.globalAlpha = 0.14; // Subtle enough to read text clearly
                context.font = "bold 20px sans-serif";
                context.fillStyle = "#1e293b";

                // Draw diagonal repeating 'cDocs' watermarks across the page
                const stepX = 220;
                const stepY = 140;

                for (let x = -canvas.width; x < canvas.width * 2; x += stepX) {
                    for (let y = -canvas.height; y < canvas.height * 2; y += stepY) {
                        context.save();
                        context.translate(x, y);
                        context.rotate(-0.45); // ~26 degrees
                        context.fillText(watermarkText, 0, 0);
                        context.restore();
                    }
                }
                context.restore();
            } catch (renderErr) {
                console.error("[Canvas Render Error]:", renderErr);
            }
        },
        [pdfDoc, scale, user]
    );

    useEffect(() => {
        if (pdfDoc) {
            renderPage(currentPage);
        }
    }, [pdfDoc, currentPage, scale, renderPage]);

    // 4. Anti-Screenshot & Screen Capture Protection
    useEffect(() => {
        // Obfuscate / blackout viewer when focus is lost (e.g. Snipping tool, screen recording, window switch)
        const handleBlur = () => {
            setIsScreenProtected(true);
        };

        const handleFocus = () => {
            setIsScreenProtected(false);
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                setIsScreenProtected(true);
            } else {
                setIsScreenProtected(false);
            }
        };

        // Intercept Screenshot Shortcuts & Print commands
        const handleKeyDown = (e: KeyboardEvent) => {
            // Block PrintScreen key
            if (e.key === "PrintScreen" || e.keyCode === 44) {
                e.preventDefault();
                setIsScreenProtected(true);
                // Purge clipboard so screenshot is blank
                try {
                    navigator.clipboard?.writeText("");
                } catch { }
                setTimeout(() => setIsScreenProtected(false), 2000);
                return;
            }

            // Block Ctrl+P / Cmd+P (Print)
            if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
                e.preventDefault();
                alert("Printing is disabled for copyrighted documents.");
                return;
            }

            // Block Ctrl+S / Cmd+S (Save)
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
                return;
            }

            // Block Ctrl+U (View Source)
            if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
                e.preventDefault();
                return;
            }

            // Block F12 / DevTools
            if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "C" || e.key === "c"))) {
                e.preventDefault();
                return;
            }

            // Navigation shortcuts
            if (e.key === "ArrowRight" || e.key === "PageDown") {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
            } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
                setCurrentPage((p) => Math.max(1, p - 1));
            } else if (e.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("blur", handleBlur);
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [totalPages, onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between select-none overflow-hidden"
            onContextMenu={(e) => e.preventDefault()}
            style={{
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
            }}
        >
            {/* Top Security Header Toolbar */}
            <div className="w-full bg-[#18202c]/95 border-b border-slate-700/80 px-4 py-3 flex items-center justify-between text-white z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                        <h3 className="text-xs sm:text-sm font-semibold truncate text-slate-100 max-w-[200px] sm:max-w-md">
                            {docItem.title}
                        </h3>
                        {(docItem.subject || docItem.semester || docItem.year) && (
                            <p className="text-[11px] text-slate-400 truncate">
                                {[docItem.subject, docItem.semester, docItem.year].filter(Boolean).join(" • ")}
                            </p>
                        )}
                    </div>
                </div>

                {/* Reader Controls (Zoom & Close) */}
                <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden sm:flex items-center bg-slate-800/80 rounded-xl p-0.5 border border-slate-700 text-xs">
                        <button
                            type="button"
                            onClick={() => setScale((s) => Math.max(0.8, s - 0.2))}
                            className="px-2.5 py-1 hover:bg-slate-700 rounded-lg cursor-pointer"
                            title="Zoom Out"
                        >
                            -
                        </button>
                        <span className="px-2 font-mono text-[11px] text-slate-300">
                            {Math.round(scale * 100)}%
                        </span>
                        <button
                            type="button"
                            onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
                            className="px-2.5 py-1 hover:bg-slate-700 rounded-lg cursor-pointer"
                            title="Zoom In"
                        >
                            +
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 text-xs font-bold border border-slate-700 cursor-pointer transition-colors"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Document Canvas Display Area */}
            <div
                ref={containerRef}
                className="relative flex-1 w-full overflow-auto flex items-center justify-center p-3 sm:p-6"
            >
                {/* Screen capture / focus-loss blackout guard */}
                {isScreenProtected && (
                    <div className="absolute inset-0 bg-black/95 z-40 flex flex-col items-center justify-center text-center p-6 text-white space-y-2">
                        <span className="text-4xl">🛡️</span>
                        <h4 className="text-base font-bold text-amber-400">
                            Screen Capture / Inactive Window Guard Active
                        </h4>
                        <p className="text-xs text-slate-400 max-w-sm">
                            Document viewing is paused when window focus is lost to prevent unauthorized recording and screenshots. Click back onto this window to resume reading.
                        </p>
                    </div>
                )}

                {isLoading && (
                    <div className="flex flex-col items-center justify-center text-slate-400 space-y-3">
                        <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-semibold">
                            Decrypting &amp; rendering document on canvas...
                        </span>
                    </div>
                )}

                {errorMessage && (
                    <div className="p-6 max-w-md bg-slate-800/90 rounded-2xl border border-rose-500/40 text-center space-y-2 text-white">
                        <span className="text-2xl">⚠️</span>
                        <h4 className="text-sm font-bold text-rose-400">Document Read Error</h4>
                        <p className="text-xs text-slate-300">{errorMessage}</p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-3 px-4 py-2 rounded-xl bg-slate-700 text-xs font-semibold hover:bg-slate-600"
                        >
                            Back to Documents
                        </button>
                    </div>
                )}

                {!isLoading && !errorMessage && (
                    <div className="relative shadow-2xl rounded-lg overflow-hidden border border-slate-700/60 bg-white">
                        {/* HTML5 Canvas: Only Pixels, No Downloadable PDF Objects */}
                        <canvas
                            ref={canvasRef}
                            className="block max-w-full h-auto cursor-default pointer-events-none"
                            onContextMenu={(e) => e.preventDefault()}
                        />
                    </div>
                )}
            </div>

            {/* Bottom Floating Page Navigator */}
            <div className="w-full bg-[#18202c]/95 border-t border-slate-700/80 px-4 py-2.5 flex items-center justify-between text-white z-20">
                <div className="text-[11px] text-slate-400 hidden sm:block">
                    Anti-Screenshot Active • Right-Click Disabled • No Download Permitted
                </div>

                <div className="flex items-center gap-2 mx-auto sm:mx-0">
                    <button
                        type="button"
                        disabled={currentPage <= 1 || isLoading}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold border border-slate-700 cursor-pointer"
                    >
                        ← Previous
                    </button>

                    <span className="px-3 text-xs font-mono font-bold text-accent">
                        Page {currentPage} of {totalPages}
                    </span>

                    <button
                        type="button"
                        disabled={currentPage >= totalPages || isLoading}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold border border-slate-700 cursor-pointer"
                    >
                        Next →
                    </button>
                </div>

                <div className="text-[11px] text-slate-400 hidden sm:block">
                    Use Arrow Keys (← / →) to Flip
                </div>
            </div>
        </div>
    );
};

export default SecureReaderModal;
