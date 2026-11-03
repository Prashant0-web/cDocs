import React, { useRef, useState, useEffect } from "react";
import { compressImageForUpload, type CapturedPage, computeFileSha256, computeImagePerceptualHash } from "../utils/upload.util";

interface ContinuousScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCompleteBatch: (newPages: CapturedPage[]) => void;
    onSwitchToFilePicker?: () => void;
    onSwitchToSystemCamera?: () => void;
}

export const ContinuousScannerModal: React.FC<ContinuousScannerModalProps> = ({
    isOpen,
    onClose,
    onCompleteBatch,
    onSwitchToFilePicker,
    onSwitchToSystemCamera,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
    const [capturedBatch, setCapturedBatch] = useState<CapturedPage[]>([]);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isPermissionDenied, setIsPermissionDenied] = useState(false);
    const [isRequestingPermission, setIsRequestingPermission] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [flashActive, setFlashActive] = useState(false);
    const [hasStartedCamera, setHasStartedCamera] = useState(false);
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

    // Audio shutter click using web audio api
    const playShutterSound = () => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.08);
        } catch {
            // Audio not supported, fallback silently
        }
    };

    // Reliable video stream synchronization whenever activeStream changes or video element binds
    useEffect(() => {
        if (videoRef.current && activeStream) {
            videoRef.current.srcObject = activeStream;
            videoRef.current.play().catch((err) => {
                console.warn("video.play() caught:", err);
            });
        }
    }, [activeStream]);

    const startCamera = async (mode: "environment" | "user" = facingMode) => {
        setCameraError(null);
        setIsPermissionDenied(false);
        setIsRequestingPermission(true);

        try {
            // Stop any existing stream before starting a new one
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
            if (activeStream) {
                activeStream.getTracks().forEach((t) => t.stop());
                setActiveStream(null);
            }

            // Check if mediaDevices API exists
            if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                const isLanInsecure =
                    typeof window !== "undefined" &&
                    !window.isSecureContext &&
                    window.location.hostname !== "localhost" &&
                    window.location.hostname !== "127.0.0.1";

                if (isLanInsecure) {
                    throw new Error(
                        "INSECURE_CONTEXT: Browsers block in-app camera over plain HTTP on local network (HTTPS or localhost is required). Tap below to use your phone's native camera or gallery photos!"
                    );
                } else {
                    throw new Error("Camera API is not supported in this browser or device.");
                }
            }

            let stream: MediaStream | null = null;
            let lastError: any = null;

            // Strategy 1: Ideal facingMode with HD resolution
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: mode },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            } catch (err1) {
                lastError = err1;
                console.warn("Camera Strategy 1 (ideal 1080p) failed, trying fallback:", err1);
            }

            // Strategy 2: Simple facingMode
            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: mode },
                        audio: false,
                    });
                } catch (err2) {
                    lastError = err2;
                    console.warn("Camera Strategy 2 (basic facing) failed, trying fallback:", err2);
                }
            }

            // Strategy 3: Any video camera (for desktop webcams, laptops, budget devices)
            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false,
                    });
                } catch (err3) {
                    lastError = err3;
                    console.warn("Camera Strategy 3 (video: true) failed:", err3);
                }
            }

            if (!stream) {
                throw lastError || new Error("Could not access any camera on this device.");
            }

            streamRef.current = stream;
            setActiveStream(stream);

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                try {
                    await videoRef.current.play();
                } catch (e) {
                    console.warn("video.play() warning:", e);
                }
            }

            setHasStartedCamera(true);
            setCameraError(null);
        } catch (err: any) {
            console.error("Camera access error:", err);
            const errMsg = String(err?.message || "");
            const isDenied =
                err?.name === "NotAllowedError" ||
                err?.name === "PermissionDeniedError" ||
                errMsg.toLowerCase().includes("permission") ||
                errMsg.toLowerCase().includes("denied");

            setIsPermissionDenied(isDenied);
            setHasStartedCamera(false);

            if (errMsg.startsWith("INSECURE_CONTEXT")) {
                setCameraError(
                    "Browsers block live WebRTC camera over HTTP on local network (only HTTPS/localhost allowed). You can tap below to snap with your phone's native camera or select gallery photos!"
                );
            } else if (isDenied) {
                setCameraError(
                    "Camera permission was denied. Tap the 🔒 lock icon in your browser address bar, set Camera to 'Allow', then tap 'Allow Camera Access'."
                );
            } else {
                setCameraError(
                    err?.message || "Unable to access camera on this device. Please use gallery/system camera."
                );
            }
        } finally {
            setIsRequestingPermission(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (activeStream) {
            activeStream.getTracks().forEach((track) => track.stop());
            setActiveStream(null);
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setHasStartedCamera(false);
    };

    useEffect(() => {
        if (isOpen) {
            startCamera(facingMode);

            // Proactively listen if user grants permission via browser site settings bar
            let permStatus: PermissionStatus | null = null;
            if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
                navigator.permissions
                    .query({ name: "camera" as PermissionName })
                    .then((status) => {
                        permStatus = status;
                        status.onchange = () => {
                            if (status.state === "granted" && !hasStartedCamera) {
                                startCamera(facingMode);
                            }
                        };
                    })
                    .catch(() => {
                        // Permissions query for camera not supported in all browsers
                    });
            }

            return () => {
                if (permStatus) {
                    permStatus.onchange = null;
                }
                stopCamera();
            };
        } else {
            stopCamera();
            setCapturedBatch([]);
        }
    }, [isOpen]);

    const toggleFacingMode = () => {
        const next = facingMode === "environment" ? "user" : "environment";
        setFacingMode(next);
        startCamera(next);
    };

    // Instant Snap: captures video frame into canvas and adds to batch while keeping camera live!
    const handleSnap = async () => {
        if (isCapturing) return;

        // If camera hasn't started or permission was not yet granted, trigger permission prompt on snap!
        if (!hasStartedCamera) {
            await startCamera(facingMode);
            return;
        }

        if (!videoRef.current || !canvasRef.current) return;

        setIsCapturing(true);
        setFlashActive(true);
        playShutterSound();

        setTimeout(() => setFlashActive(false), 120);

        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;

            const w = video.videoWidth || 1280;
            const h = video.videoHeight || 720;
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.drawImage(video, 0, 0, w, h);

            // Export to JPEG blob
            const blob: Blob | null = await new Promise((resolve) => {
                canvas.toBlob(resolve, "image/jpeg", 0.9);
            });

            if (!blob) return;

            const rawFile = new File([blob], `page-${capturedBatch.length + 1}.jpg`, {
                type: "image/jpeg",
                lastModified: Date.now(),
            });

            // Compress to ~250-350 KB
            const compressedFile = await compressImageForUpload(rawFile);
            const sha256 = await computeFileSha256(compressedFile);
            const dHash = await computeImagePerceptualHash(compressedFile);

            const newPage: CapturedPage = {
                id: `${Date.now()}-${capturedBatch.length + 1}`,
                url: URL.createObjectURL(compressedFile),
                file: compressedFile,
                name: `Page ${capturedBatch.length + 1}`,
                hash: sha256,
                dHash,
            };

            setCapturedBatch((prev) => [...prev, newPage]);
        } catch (err) {
            console.error("Frame capture error:", err);
        } finally {
            setIsCapturing(false);
        }
    };

    const handleFinishAndSave = () => {
        stopCamera();
        onCompleteBatch(capturedBatch);
        onClose();
    };

    const handleRemoveCapturedItem = (idxToRemove: number) => {
        setCapturedBatch((prev) => {
            const item = prev[idxToRemove];
            if (item?.url) URL.revokeObjectURL(item.url);
            return prev.filter((_, idx) => idx !== idxToRemove);
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden animate-in fade-in duration-200">
            {/* White flash effect on snap */}
            {flashActive && (
                <div className="absolute inset-0 z-40 bg-white pointer-events-none opacity-80 transition-opacity" />
            )}

            {/* Hidden canvas for taking snapshot */}
            <canvas ref={canvasRef} className="hidden" />

            {/* TOP BAR: Controls & Batch Counter */}
            <header className="relative z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
                <button
                    type="button"
                    onClick={() => {
                        stopCamera();
                        onClose();
                    }}
                    className="p-2 rounded-full bg-black/50 text-white hover:bg-black/80 text-sm font-bold cursor-pointer"
                    title="Close Camera"
                >
                    ✕ Close
                </button>

                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-white/20 text-white text-xs font-bold backdrop-blur-md">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Continuous Scanner</span>
                    <span className="bg-accent text-brand-dark px-1.5 py-0.2 rounded-full text-[10px] font-black">
                        {capturedBatch.length} {capturedBatch.length === 1 ? "Page" : "Pages"}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={toggleFacingMode}
                    className="p-2 rounded-full bg-black/50 text-white hover:bg-black/80 text-sm font-bold cursor-pointer"
                    title="Flip Camera (Front/Back)"
                >
                    🔄
                </button>
            </header>

            {/* MAIN VIEWFINDER */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950">
                {/* Video element is ALWAYS kept mounted in DOM so videoRef is always valid */}
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className={`w-full h-full object-cover sm:object-contain transition-opacity duration-300 ${
                        cameraError || !hasStartedCamera ? "opacity-0" : "opacity-100"
                    }`}
                />

                {/* Document Framing Guidelines Overlay (visible only when camera is active) */}
                {!cameraError && hasStartedCamera && (
                    <div className="absolute inset-8 sm:inset-16 pointer-events-none border-2 border-white/40 rounded-3xl flex flex-col justify-between p-3">
                        <div className="flex justify-between">
                            <div className="w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl-lg" />
                            <div className="w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr-lg" />
                        </div>
                        <div className="text-center">
                            <span className="bg-black/60 backdrop-blur-md text-white text-[11px] font-semibold px-3 py-1 rounded-full border border-white/20 shadow-sm">
                                {capturedBatch.length === 0
                                    ? "Frame Page 1 (Front page) & Tap Snap"
                                    : `Flip to Page ${capturedBatch.length + 1} & Tap Snap`}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <div className="w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl-lg" />
                            <div className="w-6 h-6 border-b-4 border-r-4 border-accent rounded-br-lg" />
                        </div>
                    </div>
                )}

                {/* Loading State while connecting to camera */}
                {!cameraError && !hasStartedCamera && isRequestingPermission && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white p-6 text-center z-20">
                        <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs font-semibold text-slate-200">
                            Connecting to camera...
                        </p>
                    </div>
                )}

                {/* Error / Permission Request Overlay */}
                {cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs z-30">
                        <div className="p-6 text-center text-white space-y-4 max-w-sm w-full mx-auto bg-slate-900 border border-white/10 rounded-3xl shadow-2xl">
                            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-accent flex items-center justify-center text-3xl mx-auto border border-accent/30">
                                📷
                            </div>
                            <div>
                                <h4 className="text-base font-extrabold text-white">
                                    {isPermissionDenied ? "Camera Permission Required" : "Camera Access Needed"}
                                </h4>
                                {/* <p className="text-xs text-slate-300 leading-relaxed mt-1.5">
                                    {cameraError}
                                </p> */}
                            </div>

                            {isPermissionDenied && (
                                <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-left text-[11px] text-slate-300 space-y-1">
                                    <p className="font-bold text-accent flex items-center gap-1">
                                        <span>🔒</span> Browser Unlock Guide:
                                    </p>
                                    <p>1. Tap the lock/tune icon 🔒 in your browser URL bar.</p>
                                    <p>2. Set <strong>Camera</strong> permission to <strong>Allow</strong>.</p>
                                    <p>3. Tap the "Allow Camera Access" button below.</p>
                                </div>
                            )}

                            <div className="flex flex-col gap-2 pt-1">
                                <button
                                    type="button"
                                    disabled={isRequestingPermission}
                                    onClick={() => startCamera(facingMode)}
                                    className="w-full py-2.5 rounded-xl bg-accent hover:bg-amber-400 active:scale-98 text-brand-dark text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                                >
                                    {isRequestingPermission ? (
                                        <>
                                            <div className="w-3.5 h-3.5 border-2 border-brand-dark border-t-transparent rounded-full animate-spin" />
                                            <span>Requesting Permission...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Allow Camera Access</span>
                                            <span>📸</span>
                                        </>
                                    )}
                                </button>

                                {onSwitchToSystemCamera && (
                                    <button
                                        type="button"
                                        onClick={onSwitchToSystemCamera}
                                        className="w-full py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                                    >
                                        <span>Use Phone Native Camera App</span>
                                        <span>📱</span>
                                    </button>
                                )}

                                {onSwitchToFilePicker && (
                                    <button
                                        type="button"
                                        onClick={onSwitchToFilePicker}
                                        className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all cursor-pointer"
                                    >
                                        Select from Device Photos / Files 🖼️
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* BOTTOM BAR: Captured Tray + Big Shutter Button + Done Button */}
            <footer className="relative z-20 p-4 sm:p-6 bg-gradient-to-t from-black via-black/80 to-transparent flex flex-col gap-3">
                {/* Horizontal thumbnail tray of snapped pages */}
                {capturedBatch.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                        <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">
                            Snapped:
                        </span>
                        {capturedBatch.map((page, idx) => (
                            <div
                                key={page.id}
                                className="relative shrink-0 w-12 h-16 rounded-lg overflow-hidden border-2 border-accent bg-slate-900 shadow-md group"
                            >
                                <img
                                    src={page.url}
                                    alt={`Page ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-0.5 left-0.5 bg-black/80 text-white text-[8px] font-bold px-1 rounded">
                                    P{idx + 1}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCapturedItem(idx)}
                                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center cursor-pointer shadow-xs"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Shutter & Done Controls */}
                <div className="flex items-center justify-between max-w-md mx-auto w-full px-2">
                    {/* Left: Thumbnail stack indicator */}
                    <div className="w-16 flex items-center justify-center">
                        {capturedBatch.length > 0 && (
                            <span className="text-xs font-extrabold text-amber-300">
                                {capturedBatch.length} {capturedBatch.length === 1 ? "page" : "pages"}
                            </span>
                        )}
                    </div>

                    {/* Center: BIG SHUTTER BUTTON (Keeps camera open, takes photo after photo!) */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            type="button"
                            disabled={isCapturing || isRequestingPermission}
                            onClick={handleSnap}
                            className="w-18 h-18 sm:w-20 sm:h-20 rounded-full border-4 border-white bg-accent hover:bg-amber-400 active:scale-95 transition-transform flex items-center justify-center shadow-2xl cursor-pointer disabled:opacity-50"
                            title={!hasStartedCamera ? "Allow camera permission & snap" : "Snap this page and flip to next!"}
                        >
                            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-brand-dark/30 bg-accent flex items-center justify-center text-2xl font-bold">
                                {isRequestingPermission ? "⏳" : "📸"}
                            </div>
                        </button>
                        <span className="text-[11px] font-bold text-white tracking-tight">
                            {!hasStartedCamera
                                ? (isRequestingPermission ? "Requesting Access..." : "Allow Camera & Snap")
                                : `Snap Page ${capturedBatch.length + 1}`}
                        </span>
                    </div>

                    {/* Right: DONE BUTTON (Closes camera and sends all pages to upload form) */}
                    <div className="w-16 flex items-center justify-end">
                        <button
                            type="button"
                            disabled={capturedBatch.length === 0}
                            onClick={handleFinishAndSave}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1 shrink-0"
                            title="Done with all pages"
                        >
                            <span>Done</span>
                            <span>✓</span>
                        </button>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default ContinuousScannerModal;
