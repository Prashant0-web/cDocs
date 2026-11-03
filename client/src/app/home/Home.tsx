import React, { useState, useRef, useEffect } from "react";
import Navbar from "../../components/Navbar";
import { SignUp } from "../auth/auth";
import type { StoredUser } from "../../utils/cookie.util";
import { get } from "../../services/api.service";
import { SecureReaderModal, type SecureReaderDoc } from "../../components/SecureReaderModal";

interface HomeProps {
    user: StoredUser | null;
    onSignOut: () => void;
    onAuthSuccess?: (user: StoredUser) => void;
    onNavigatePrivacy?: () => void;
    onNavigateUpload?: () => void;
    onNavigatePaper?: (paperId: string) => void;
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
    tags?: string[];
    matchScore?: number;
    isTopMatch?: boolean;
    matchingReasons?: string[];
}

export const Home: React.FC<HomeProps> = ({
    user,
    onSignOut,
    onAuthSuccess,
    onNavigatePrivacy,
    onNavigateUpload,
    onNavigatePaper,
}) => {
    const handlePaperCardClick = (paper: PaperItem) => {
        if (onNavigatePaper) {
            onNavigatePaper(paper.id);
        } else {
            window.history.pushState({}, "", `/paper/${paper.id}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }
    };
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<PaperItem[]>([]);
    const [hasSearched, setHasSearched] = useState(false);

    // Auth gatekeeper state
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    // Sign out confirmation modal state
    const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);

    // Active DRM in-app reader state
    const [activeReadingDoc, setActiveReadingDoc] = useState<SecureReaderDoc | null>(null);

    // Latest uploaded papers for Master Section horizontal carousel
    const [latestPapers, setLatestPapers] = useState<PaperItem[]>([]);
    const [isLoadingLatest, setIsLoadingLatest] = useState<boolean>(true);
    const latestScrollRef = useRef<HTMLDivElement>(null);

    const scrollLatest = (direction: "left" | "right") => {
        if (latestScrollRef.current) {
            const offset = direction === "left" ? -300 : 300;
            latestScrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
        }
    };

    // Most viewed papers for Master Section horizontal carousel
    const [mostViewedPapers, setMostViewedPapers] = useState<PaperItem[]>([]);
    const [isLoadingMostViewed, setIsLoadingMostViewed] = useState<boolean>(true);
    const mostViewedScrollRef = useRef<HTMLDivElement>(null);

    const scrollMostViewed = (direction: "left" | "right") => {
        if (mostViewedScrollRef.current) {
            const offset = direction === "left" ? -300 : 300;
            mostViewedScrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
        }
    };

    // AI-generated search query tags
    const [aiQueryTags, setAiQueryTags] = useState<string[]>([]);

    // Search Autocomplete Suggestions State
    const [suggestions, setSuggestions] = useState<Array<{ type: string; value: string; label: string }>>([]);
    const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);

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
                thumbnailUrl: doc.thumbnailUrl || null,
                topCode: doc.topCode,
                paperCode: doc.paperCode,
                tags: doc.tags || [],
                matchScore: doc.matchScore,
                isTopMatch: Boolean(doc.isTopMatch),
                matchingReasons: doc.matchingReasons || [],
            }));
            setSearchResults(mapped);
            if (!query) {
                setLatestPapers(mapped);
                setIsLoadingLatest(false);
            }
        } catch (err) {
            console.error("Failed to fetch documents:", err);
            setSearchResults([]);
            if (!query) {
                setIsLoadingLatest(false);
            }
        } finally {
            setIsSearching(false);
        }
    };

    const fetchMostViewed = async () => {
        setIsLoadingMostViewed(true);
        try {
            const res = await get<{ success: boolean; data: { documents: any[] } }>("/documents?sortBy=views&limit=12");
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
                thumbnailUrl: doc.thumbnailUrl || null,
                topCode: doc.topCode,
                paperCode: doc.paperCode,
                tags: doc.tags || [],
                matchScore: doc.matchScore,
                isTopMatch: Boolean(doc.isTopMatch),
                matchingReasons: doc.matchingReasons || [],
            }));
            mapped.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
            setMostViewedPapers(mapped);
        } catch {
            setMostViewedPapers([]);
        } finally {
            setIsLoadingMostViewed(false);
        }
    };

    // Load documents on initial render
    useEffect(() => {
        fetchPapers();
        fetchMostViewed();
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

    // Quick camera snap button for mobile & desktop
    const triggerCameraSnap = () => {
        requireAuth(() => {
            if (onNavigateUpload) {
                onNavigateUpload();
            } else {
                window.history.pushState({}, "", "/upload");
                window.dispatchEvent(new PopStateEvent("popstate"));
            }
        });
    };

    const handleUploadBannerClick = () => {
        requireAuth(() => {
            if (onNavigateUpload) {
                onNavigateUpload();
            } else {
                window.history.pushState({}, "", "/upload");
                window.dispatchEvent(new PopStateEvent("popstate"));
            }
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


    return (
        <div className="min-h-screen bg-white text-slate-800 flex flex-col font-sans selection:bg-accent/40 selection:text-brand-dark pb-20 md:pb-0">
            {/* Top Navigation Bar */}
            <Navbar
                user={user}
                onSignOut={() => setIsSignOutConfirmOpen(true)}
                onRequestAuth={() => requireAuth()}
                onNavigateUpload={onNavigateUpload}
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
                        {/* 
                        <p className="text-xs sm:text-base md:text-lg text-slate-600 max-w-3xl leading-relaxed mb-5 sm:mb-8">
                            We’ve all been there—exam tomorrow, syllabus untouched, and zero clue what questions actually show up. <strong className="text-brand-dark font-semibold">cDocs (Chutiya Docs)</strong> is the crowd-sourced repository built by stressed students to find previous years&apos; papers and notes without endless WhatsApp digging.
                        </p>
                        */}

                        {/* Search Bar Form with Floating Autocomplete */}
                        <div className="w-full max-w-2xl mb-4 sm:mb-6">
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
                            <div className="w-full max-w-3xl mt-1 mb-6 sm:mb-8 text-left bg-white rounded-2xl border border-slate-200 shadow-md p-4 sm:p-5 transition-all">
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
                                                onClick={() => handlePaperCardClick(paper)}
                                                className="p-3 sm:p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-white hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs group cursor-pointer"
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
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleReadPaper(paper);
                                                    }}
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

                        {/* Horizontal list of latest uploaded question papers */}
                        <div className="w-full max-w-3xl mx-auto mb-5 sm:mb-6">
                            <div className="flex items-center justify-between mb-2 px-1">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
                                        <span>Latest Uploaded Papers</span>
                                        <span className="text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full">
                                            Recent
                                        </span>
                                    </h3>
                                </div>
                                {latestPapers.length > 0 && (
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => scrollLatest("left")}
                                            className="p-1 rounded-lg border border-slate-200/80 hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                                            title="Scroll left"
                                            aria-label="Scroll left"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => scrollLatest("right")}
                                            className="p-1 rounded-lg border border-slate-200/80 hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                                            title="Scroll right"
                                            aria-label="Scroll right"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div
                                ref={latestScrollRef}
                                className="flex items-stretch gap-3 overflow-x-auto no-scrollbar scroll-smooth py-1 px-1 -mx-2 sm:mx-0"
                            >
                                {isLoadingLatest ? (
                                    [1, 2, 3, 4].map((n) => (
                                        <div
                                            key={n}
                                            className="w-60 sm:w-68 shrink-0 bg-white/80 border border-slate-200/70 rounded-2xl p-3 flex items-center gap-2.5 animate-pulse"
                                        >
                                            <div className="w-11 h-14 bg-slate-200 rounded-lg shrink-0" />
                                            <div className="flex-1 space-y-1.5">
                                                <div className="h-3 bg-slate-200 rounded w-3/4" />
                                                <div className="h-2.5 bg-slate-200 rounded w-1/2" />
                                                <div className="h-2 bg-slate-200 rounded w-1/3" />
                                            </div>
                                        </div>
                                    ))
                                ) : latestPapers.length === 0 ? (
                                    <div className="w-full py-3.5 px-4 bg-white/70 border border-slate-200/80 rounded-2xl text-center text-xs text-slate-500 shadow-2xs">
                                        No question papers uploaded yet. Be the first to upload and help other students!
                                    </div>
                                ) : (
                                    latestPapers.map((paper) => (
                                        <div
                                            key={paper.id}
                                            onClick={() => handlePaperCardClick(paper)}
                                            className="w-60 sm:w-68 shrink-0 bg-white hover:bg-slate-50/80 border border-slate-200/90 hover:border-brand/50 rounded-2xl p-2.5 sm:p-3 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer group flex items-start gap-2.5 text-left active:scale-[0.98]"
                                        >
                                            {/* Thumbnail */}
                                            {paper.thumbnailUrl ? (
                                                <div className="w-11 h-14 sm:w-12 sm:h-16 rounded-xl overflow-hidden border border-slate-200/80 bg-slate-100 shrink-0 group-hover:scale-105 transition-transform">
                                                    <img
                                                        src={paper.thumbnailUrl}
                                                        alt={paper.title}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            (e.currentTarget as HTMLElement).style.display = "none";
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-11 h-14 sm:w-12 sm:h-16 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex flex-col items-center justify-center shrink-0">
                                                    <span className="text-base sm:text-lg">📄</span>
                                                    <span className="text-[8px] font-black uppercase tracking-wider text-emerald-800">DOC</span>
                                                </div>
                                            )}

                                            {/* Metadata */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                                                <div>
                                                    <div className="flex items-center gap-1 mb-1">
                                                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60 truncate max-w-[100px]">
                                                            {paper.semester || paper.year}
                                                        </span>
                                                        {paper.paperCode && (
                                                            <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-700 px-1 py-0.2 rounded truncate max-w-[80px]">
                                                                {paper.paperCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h4 className="text-xs font-bold text-brand-dark group-hover:text-brand transition-colors line-clamp-1 leading-snug">
                                                        {paper.title}
                                                    </h4>
                                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                                        {paper.subject || paper.course}
                                                    </p>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100/80 mt-1">
                                                    <span className="truncate max-w-[90px]">@{paper.uploadedBy}</span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleReadPaper(paper);
                                                        }}
                                                        className="font-bold text-emerald-600 hover:underline flex items-center gap-0.5 shrink-0 cursor-pointer"
                                                    >
                                                        Read 👁️
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Horizontal list of most viewed question papers */}
                        <div className="w-full max-w-3xl mx-auto mb-6 sm:mb-8">
                            <div className="flex items-center justify-between mb-2 px-1">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                    </span>
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
                                        <span>🔥 Most Viewed Papers</span>
                                        <span className="text-[10px] font-extrabold uppercase bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded-full">
                                            Trending
                                        </span>
                                    </h3>
                                </div>
                                {mostViewedPapers.length > 0 && (
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => scrollMostViewed("left")}
                                            className="p-1 rounded-lg border border-slate-200/80 hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                                            title="Scroll left"
                                            aria-label="Scroll left"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => scrollMostViewed("right")}
                                            className="p-1 rounded-lg border border-slate-200/80 hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                                            title="Scroll right"
                                            aria-label="Scroll right"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div
                                ref={mostViewedScrollRef}
                                className="flex items-stretch gap-3 overflow-x-auto no-scrollbar scroll-smooth py-1 px-1 -mx-2 sm:mx-0"
                            >
                                {isLoadingMostViewed ? (
                                    [1, 2, 3, 4].map((n) => (
                                        <div
                                            key={n}
                                            className="w-60 sm:w-68 shrink-0 bg-white/80 border border-slate-200/70 rounded-2xl p-3 flex items-center gap-2.5 animate-pulse"
                                        >
                                            <div className="w-11 h-14 bg-slate-200 rounded-lg shrink-0" />
                                            <div className="flex-1 space-y-1.5">
                                                <div className="h-3 bg-slate-200 rounded w-3/4" />
                                                <div className="h-2.5 bg-slate-200 rounded w-1/2" />
                                                <div className="h-2 bg-slate-200 rounded w-1/3" />
                                            </div>
                                        </div>
                                    ))
                                ) : mostViewedPapers.length === 0 ? (
                                    <div className="w-full py-3.5 px-4 bg-white/70 border border-slate-200/80 rounded-2xl text-center text-xs text-slate-500 shadow-2xs">
                                        No trending papers yet. Read a question paper to see it featured here!
                                    </div>
                                ) : (
                                    mostViewedPapers.map((paper) => (
                                        <div
                                            key={paper.id}
                                            onClick={() => handlePaperCardClick(paper)}
                                            className="w-60 sm:w-68 shrink-0 bg-white hover:bg-amber-50/30 border border-slate-200/90 hover:border-amber-400/60 rounded-2xl p-2.5 sm:p-3 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer group flex items-start gap-2.5 text-left active:scale-[0.98]"
                                        >
                                            {/* Thumbnail */}
                                            {paper.thumbnailUrl ? (
                                                <div className="w-11 h-14 sm:w-12 sm:h-16 rounded-xl overflow-hidden border border-slate-200/80 bg-slate-100 shrink-0 group-hover:scale-105 transition-transform">
                                                    <img
                                                        src={paper.thumbnailUrl}
                                                        alt={paper.title}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            (e.currentTarget as HTMLElement).style.display = "none";
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-11 h-14 sm:w-12 sm:h-16 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex flex-col items-center justify-center shrink-0">
                                                    <span className="text-base sm:text-lg">🔥</span>
                                                    <span className="text-[8px] font-black uppercase tracking-wider text-amber-800">DOC</span>
                                                </div>
                                            )}

                                            {/* Metadata */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                                                <div>
                                                    <div className="flex items-center gap-1 mb-1">
                                                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300/60 truncate max-w-[100px]">
                                                            {paper.semester || paper.year}
                                                        </span>
                                                        {paper.paperCode && (
                                                            <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-700 px-1 py-0.2 rounded truncate max-w-[80px]">
                                                                {paper.paperCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h4 className="text-xs font-bold text-brand-dark group-hover:text-amber-700 transition-colors line-clamp-1 leading-snug">
                                                        {paper.title}
                                                    </h4>
                                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                                        {paper.subject || paper.course}
                                                    </p>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100/80 mt-1">
                                                    <span className="font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200/60 shrink-0">
                                                        👁️ {paper.downloads} views
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleReadPaper(paper);
                                                        }}
                                                        className="font-bold text-brand hover:underline flex items-center gap-0.5 shrink-0 cursor-pointer"
                                                    >
                                                        Read ➔
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
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
                        onClick={handleUploadBannerClick}
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
