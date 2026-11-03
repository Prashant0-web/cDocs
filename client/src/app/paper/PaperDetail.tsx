import React, { useState, useEffect } from "react";
import { Navbar } from "../../components/Navbar";
import { SecureReaderModal } from "../../components/SecureReaderModal";
import { get, post } from "../../services/api.service";
import type { StoredUser } from "../../utils/cookie.util";

interface PaperReview {
    _id: string;
    documentId: string;
    username: string;
    stars: number;
    feedback: string;
    tags?: string[];
    createdAt: string;
    created_by?: {
        username?: string;
        email?: string;
    };
}

interface PaperDetailDoc {
    id: string;
    title: string;
    subject?: string;
    subjectCode?: string;
    college?: string;
    course?: string;
    semester?: string;
    examYear?: string;
    examType?: string;
    topCode?: string;
    paperCode?: string;
    tags?: string[];
    thumbnailUrl?: string | null;
    totalPages?: number;
    views?: number;
    createdAt?: string;
    created_by?: {
        username?: string;
        email?: string;
    };
}

interface PaperDetailProps {
    paperId: string;
    user: StoredUser | null;
    onNavigateHome: () => void;
    onRequestAuth?: (reason?: string) => void;
    onSignOut: () => void;
}

const PRESET_TAGS = [
    "🔥 High-yield questions",
    "✨ Clear scans",
    "💯 Exact syllabus match",
    "📝 Includes solution hints",
    "⚠️ Tough numericals",
];

export const PaperDetail: React.FC<PaperDetailProps> = ({
    paperId,
    user,
    onNavigateHome,
    onRequestAuth,
    onSignOut,
}) => {
    // Document state
    const [doc, setDoc] = useState<PaperDetailDoc | null>(null);
    const [isLoadingDoc, setIsLoadingDoc] = useState(true);
    const [docError, setDocError] = useState<string | null>(null);

    // Reviews state
    const [reviews, setReviews] = useState<PaperReview[]>([]);
    const [totalReviews, setTotalReviews] = useState(0);
    const [averageStars, setAverageStars] = useState(5.0);
    const [breakdown, setBreakdown] = useState<Record<number, number>>({
        5: 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
    });
    const [isLoadingReviews, setIsLoadingReviews] = useState(true);

    // Review submission form state
    const [reviewStars, setReviewStars] = useState(5);
    const [hoverStars, setHoverStars] = useState(0);
    const [reviewFeedback, setReviewFeedback] = useState("");
    const [reviewerName, setReviewerName] = useState(user?.username || "");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [isSubmittingReview, setIsSubmittingReview] = useState(false);
    const [submitSuccessMsg, setSubmitSuccessMsg] = useState<string | null>(null);
    const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);

    // Secure Reader Modal state
    const [isReaderOpen, setIsReaderOpen] = useState(false);

    // Copy share link toast
    const [copiedShare, setCopiedShare] = useState(false);

    // Fetch document details
    const fetchDoc = async () => {
        setIsLoadingDoc(true);
        setDocError(null);
        try {
            const res = await get<{ success: boolean; data: any }>(`/documents/${paperId}`);
            if (res?.data) {
                const d = res.data;
                setDoc({
                    id: d._id || d.id,
                    title: d.title,
                    subject: d.subject || d.subjectCode || "Exam Paper",
                    subjectCode: d.subjectCode,
                    college: d.college,
                    course: d.course,
                    semester: d.semester,
                    examYear: d.examYear || d.year || "2024",
                    examType: d.examType || "Endsem",
                    topCode: d.topCode,
                    paperCode: d.paperCode,
                    tags: d.tags || [],
                    thumbnailUrl: d.thumbnailUrl || null,
                    totalPages: d.totalPages || (d.pages ? d.pages.length : 1),
                    views: d.views || 0,
                    createdAt: d.createdAt,
                    created_by: d.created_by,
                });
            } else {
                setDocError("Question paper not found.");
            }
        } catch (err: any) {
            setDocError(err?.message || "Failed to load document details.");
        } finally {
            setIsLoadingDoc(false);
        }
    };

    // Fetch document reviews & rating breakdown
    const fetchReviews = async () => {
        setIsLoadingReviews(true);
        try {
            const res = await get<{
                success: boolean;
                data: {
                    reviews: PaperReview[];
                    totalReviews: number;
                    averageStars: number;
                    breakdown: Record<number, number>;
                };
            }>(`/documents/${paperId}/reviews`);

            if (res?.data) {
                setReviews(res.data.reviews || []);
                setTotalReviews(res.data.totalReviews || 0);
                setAverageStars(res.data.averageStars || 5.0);
                setBreakdown(res.data.breakdown || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
            }
        } catch {
            // Keep default empty reviews
        } finally {
            setIsLoadingReviews(false);
        }
    };

    useEffect(() => {
        if (paperId) {
            fetchDoc();
            fetchReviews();
        }
    }, [paperId]);

    // Handle review submit
    const handleSubmitReview = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitErrorMsg(null);
        setSubmitSuccessMsg(null);

        if (!reviewFeedback.trim()) {
            setSubmitErrorMsg("Please write a short review or feedback message.");
            return;
        }

        setIsSubmittingReview(true);
        try {
            const payload = {
                stars: reviewStars,
                feedback: reviewFeedback.trim(),
                username: reviewerName.trim() || user?.username || "Anonymous Student",
                tags: selectedTags,
            };

            const res = await post<
                typeof payload,
                { success: boolean; message: string; data: PaperReview }
            >(`/documents/${paperId}/reviews`, payload);

            if (res?.success) {
                setSubmitSuccessMsg("Thank you! Your review has been saved to the database.");
                setReviewFeedback("");
                setSelectedTags([]);
                // Re-fetch reviews to update average and breakdown
                fetchReviews();

                setTimeout(() => {
                    setSubmitSuccessMsg(null);
                }, 4000);
            }
        } catch (err: any) {
            setSubmitErrorMsg(err?.message || "Failed to submit review. Please try again.");
        } finally {
            setIsSubmittingReview(false);
        }
    };

    const togglePresetTag = (tag: string) => {
        if (selectedTags.includes(tag)) {
            setSelectedTags(selectedTags.filter((t) => t !== tag));
        } else {
            setSelectedTags([...selectedTags, tag]);
        }
    };

    const handleSharePaper = () => {
        if (typeof window !== "undefined") {
            navigator.clipboard.writeText(window.location.href);
            setCopiedShare(true);
            setTimeout(() => setCopiedShare(false), 2500);
        }
    };

    const getStarLabel = (s: number) => {
        switch (s) {
            case 5:
                return "5★ - Excellent & High Yield!";
            case 4:
                return "4★ - Very Good";
            case 3:
                return "3★ - Average Quality";
            case 2:
                return "2★ - Poor / Blurry";
            case 1:
                return "1★ - Irrelevant / Wrong Paper";
            default:
                return "";
        }
    };

    return (
        <div className="min-h-screen bg-brand-light/30 text-slate-800 flex flex-col font-sans selection:bg-accent/40 selection:text-brand-dark pb-16">
            <Navbar user={user} onSignOut={onSignOut} onRequestAuth={onRequestAuth} />

            <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8">
                {/* Back Link & Action Bar */}
                <div className="flex items-center justify-between mb-4">
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

                    <button
                        type="button"
                        onClick={handleSharePaper}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer"
                    >
                        <span>{copiedShare ? "✓ Copied Link!" : "🔗 Share Paper"}</span>
                    </button>
                </div>

                {isLoadingDoc ? (
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 animate-pulse space-y-4">
                        <div className="h-6 bg-slate-200 rounded w-1/3" />
                        <div className="h-4 bg-slate-200 rounded w-2/3" />
                        <div className="h-32 bg-slate-100 rounded-2xl" />
                    </div>
                ) : docError || !doc ? (
                    <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center space-y-3">
                        <div className="text-4xl">📄</div>
                        <h2 className="text-lg font-bold text-brand-dark">Question Paper Not Found</h2>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            {docError || "This question paper might have been removed or the ID is invalid."}
                        </p>
                        <button
                            type="button"
                            onClick={onNavigateHome}
                            className="px-5 py-2 rounded-xl bg-brand text-white text-xs font-bold cursor-pointer"
                        >
                            Back to Home
                        </button>
                    </div>
                ) : (
                    <>
                        {/* =========================================================================
                            TOP ~25% HERO SECTION: Thumbnail + Paper Metadata & Primary Actions
                           ========================================================================= */}
                        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/90 shadow-sm mb-6 transition-all">
                            <div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-7">
                                {/* Thumbnail Container (Left) */}
                                <div className="w-full sm:w-44 md:w-52 shrink-0">
                                    <div className="aspect-[3/4] w-full rounded-2xl overflow-hidden border border-slate-200/90 bg-slate-100 relative group shadow-sm flex items-center justify-center">
                                        {doc.thumbnailUrl ? (
                                            <img
                                                src={doc.thumbnailUrl}
                                                alt={doc.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-emerald-50 text-emerald-800 flex flex-col items-center justify-center p-4 text-center">
                                                <span className="text-4xl mb-1">📄</span>
                                                <span className="text-[10px] font-black uppercase tracking-wider">
                                                    EXAM DOC
                                                </span>
                                            </div>
                                        )}

                                        <div className="absolute top-2 left-2 bg-brand-dark/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-xs">
                                            {doc.totalPages || 1} Pages
                                        </div>

                                        <div className="absolute inset-0 bg-brand-dark/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                            <span className="px-3 py-1 rounded-full bg-white/95 text-brand-dark font-bold text-xs shadow-md">
                                                Click Read to View
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Metadata & Action Details (Right) */}
                                <div className="flex-1 flex flex-col justify-between self-stretch min-w-0">
                                    <div>
                                        {/* Badges Row */}
                                        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                {doc.semester || "Semester"}
                                            </span>
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                                {doc.examType}
                                            </span>
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                                {doc.examYear}
                                            </span>
                                            {doc.paperCode && (
                                                <span className="text-[10px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded">
                                                    Paper: {doc.paperCode}
                                                </span>
                                            )}
                                            {doc.topCode && (
                                                <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded">
                                                    Top Code: {doc.topCode}
                                                </span>
                                            )}
                                        </div>

                                        {/* Paper Title */}
                                        <h1 className="text-lg sm:text-2xl md:text-3xl font-extrabold text-brand-dark tracking-tight leading-snug">
                                            {doc.title}
                                        </h1>

                                        {/* Subject / University */}
                                        <p className="text-xs sm:text-sm font-medium text-slate-600 mt-1">
                                            {doc.subject} {doc.college ? `• ${doc.college}` : ""} {doc.course ? `• ${doc.course}` : ""}
                                        </p>

                                        {/* Tags */}
                                        {doc.tags && doc.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-2.5">
                                                {doc.tags.map((t, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full"
                                                    >
                                                        #{t}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Stats & Read Action Row */}
                                    <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="flex items-center gap-4 text-xs text-slate-500">
                                            <span className="flex items-center gap-1 font-semibold text-slate-700">
                                                <span>👁️</span>
                                                <span>{doc.views || 0} reads</span>
                                            </span>
                                            <span className="flex items-center gap-1 font-semibold text-amber-700">
                                                <span>⭐</span>
                                                <span>{averageStars} ({totalReviews} reviews)</span>
                                            </span>
                                            <span className="text-slate-400">
                                                Uploaded by @{doc.created_by?.username || "student"}
                                            </span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setIsReaderOpen(true)}
                                            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <span>Read Paper in App</span>
                                            <span className="text-base">👁️</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* =========================================================================
                            BOTTOM SECTION: Reviews & Feedback Option (Saved to document_reviews)
                           ========================================================================= */}
                        <section className="space-y-6">
                            {/* Section Header */}
                            <div className="flex items-center justify-between px-1">
                                <div>
                                    <h2 className="text-base sm:text-xl font-bold text-brand-dark flex items-center gap-2">
                                        <span>Student Reviews &amp; Feedback</span>
                                        <span className="text-xs font-semibold text-slate-500">
                                            ({totalReviews})
                                        </span>
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Did this question paper help your exam preparation? Leave a rating for fellow students.
                                    </p>
                                </div>
                            </div>

                            {/* Rating Breakdown & Stats Card */}
                            <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/90 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                                {/* Overall Average Score */}
                                <div className="text-center md:border-r border-slate-100 md:pr-6">
                                    <div className="text-4xl sm:text-5xl font-black text-brand-dark">
                                        {averageStars}
                                    </div>
                                    <div className="flex items-center justify-center gap-1 text-amber-400 text-lg my-1">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <span key={star}>
                                                {star <= Math.round(averageStars) ? "★" : "☆"}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-xs text-slate-500 font-medium">
                                        Based on {totalReviews} student review{totalReviews === 1 ? "" : "s"}
                                    </p>
                                </div>

                                {/* Star Distribution Progress Bars */}
                                <div className="md:col-span-2 space-y-1.5">
                                    {[5, 4, 3, 2, 1].map((s) => {
                                        const count = breakdown[s] || 0;
                                        const pct = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
                                        return (
                                            <div key={s} className="flex items-center gap-2 text-xs">
                                                <span className="w-8 font-bold text-slate-600 flex items-center gap-0.5">
                                                    <span>{s}</span>
                                                    <span className="text-amber-400">★</span>
                                                </span>
                                                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                                                    <div
                                                        className="h-full bg-accent rounded-full transition-all duration-300"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <span className="w-12 text-right text-[11px] text-slate-400 font-mono">
                                                    {count} ({pct}%)
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Write Review Form Card */}
                            <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/90 shadow-sm space-y-4">
                                <div className="border-b border-slate-100 pb-3">
                                    <h3 className="text-sm sm:text-base font-bold text-brand-dark flex items-center gap-1.5">
                                        <span>✍️</span>
                                        <span>Leave Your Review &amp; Feedback</span>
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Saved in the review collection to help students decide which papers to study first.
                                    </p>
                                </div>

                                {submitSuccessMsg && (
                                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                                        <span>🎉</span>
                                        <span>{submitSuccessMsg}</span>
                                    </div>
                                )}

                                {submitErrorMsg && (
                                    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2">
                                        <span>⚠️</span>
                                        <span>{submitErrorMsg}</span>
                                    </div>
                                )}

                                <form onSubmit={handleSubmitReview} className="space-y-4">
                                    {/* Star Rating Picker */}
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1.5">
                                            Rating *
                                        </label>
                                        <div className="flex items-center gap-1.5">
                                            {[1, 2, 3, 4, 5].map((s) => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onMouseEnter={() => setHoverStars(s)}
                                                    onMouseLeave={() => setHoverStars(0)}
                                                    onClick={() => setReviewStars(s)}
                                                    className="text-2xl sm:text-3xl transition-transform hover:scale-110 cursor-pointer focus:outline-none"
                                                    title={`Rate ${s} stars`}
                                                >
                                                    <span
                                                        className={
                                                            (hoverStars || reviewStars) >= s
                                                                ? "text-amber-400"
                                                                : "text-slate-200"
                                                        }
                                                    >
                                                        ★
                                                    </span>
                                                </button>
                                            ))}
                                            <span className="ml-2 text-xs font-bold text-slate-600">
                                                {getStarLabel(hoverStars || reviewStars)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Quick Tags Selection */}
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1.5">
                                            Quick Feedback Tags
                                        </label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {PRESET_TAGS.map((t) => {
                                                const isSel = selectedTags.includes(t);
                                                return (
                                                    <button
                                                        key={t}
                                                        type="button"
                                                        onClick={() => togglePresetTag(t)}
                                                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                                                            isSel
                                                                ? "bg-accent/40 text-brand-dark border-accent-dark font-bold shadow-2xs"
                                                                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                                                        }`}
                                                    >
                                                        {t}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Feedback Message */}
                                    <div>
                                        <label className="block text-xs font-bold text-brand-dark mb-1.5">
                                            Review / Feedback Message *
                                        </label>
                                        <textarea
                                            required
                                            rows={3}
                                            value={reviewFeedback}
                                            onChange={(e) => setReviewFeedback(e.target.value)}
                                            placeholder="Was this paper helpful? Were questions repeated from here? Any blurry pages or tough numericals?..."
                                            className="w-full p-3 rounded-xl border border-slate-300 text-xs sm:text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
                                        />
                                    </div>

                                    {/* Reviewer Name */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="w-full sm:w-64">
                                            <label className="block text-[11px] font-bold text-slate-500 mb-1">
                                                Posting as
                                            </label>
                                            <input
                                                type="text"
                                                value={reviewerName}
                                                onChange={(e) => setReviewerName(e.target.value)}
                                                placeholder="Your name or handle"
                                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/20"
                                            />
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isSubmittingReview}
                                            className="px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-75 text-white text-xs sm:text-sm font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2 self-end sm:self-auto"
                                        >
                                            {isSubmittingReview ? (
                                                <>
                                                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    <span>Submitting...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span>Post Feedback</span>
                                                    <span>➔</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Reviews Feed List */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
                                    All Student Reviews ({reviews.length})
                                </h3>

                                {isLoadingReviews ? (
                                    <div className="space-y-2">
                                        {[1, 2].map((n) => (
                                            <div
                                                key={n}
                                                className="bg-white rounded-2xl p-4 border border-slate-200 animate-pulse space-y-2"
                                            >
                                                <div className="h-4 bg-slate-200 rounded w-1/4" />
                                                <div className="h-3 bg-slate-100 rounded w-3/4" />
                                            </div>
                                        ))}
                                    </div>
                                ) : reviews.length === 0 ? (
                                    <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-2 shadow-2xs">
                                        <span className="text-3xl block">💬</span>
                                        <div className="text-sm font-bold text-brand-dark">
                                            No student reviews yet
                                        </div>
                                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                            Be the first student to review this question paper! Your feedback helps your fellow classmates study effectively.
                                        </p>
                                    </div>
                                ) : (
                                    reviews.map((rev) => (
                                        <div
                                            key={rev._id}
                                            className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs space-y-2.5 transition-all hover:border-slate-300"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-full bg-brand-light border border-slate-200 text-brand-dark font-bold text-xs flex items-center justify-center">
                                                        {(rev.username || "S")[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs font-bold text-brand-dark">
                                                                @{rev.username}
                                                            </span>
                                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                                                ✓ Verified Student
                                                            </span>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400">
                                                            {new Date(rev.createdAt).toLocaleDateString("en-IN", {
                                                                day: "numeric",
                                                                month: "short",
                                                                year: "numeric",
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-0.5 text-amber-400 text-sm">
                                                    {[1, 2, 3, 4, 5].map((s) => (
                                                        <span key={s}>
                                                            {s <= rev.stars ? "★" : "☆"}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                                                {rev.feedback}
                                            </p>

                                            {rev.tags && rev.tags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 pt-1">
                                                    {rev.tags.map((t, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md"
                                                        >
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </>
                )}
            </main>

            {/* Secure In-App Reader Modal (Binary stream without exposing PDF URL) */}
            {isReaderOpen && doc && (
                <SecureReaderModal
                    document={{
                        id: doc.id,
                        title: doc.title,
                        subject: doc.subject,
                        course: doc.course,
                        semester: doc.semester,
                        year: doc.examYear,
                        totalPages: doc.totalPages,
                    }}
                    user={user}
                    onClose={() => setIsReaderOpen(false)}
                />
            )}
        </div>
    );
};

export default PaperDetail;
