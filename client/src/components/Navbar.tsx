import React, { useState } from "react";
import type { StoredUser } from "../utils/cookie.util";

interface NavbarProps {
    user: StoredUser | null;
    onSignOut: () => void;
    onRequestAuth?: (reason?: string) => void;
    onScrollToSection?: (id: string) => void;
    onNavigateUpload?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
    user,
    onSignOut,
    onRequestAuth,
    onNavigateUpload,
}) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-50 shadow-xs">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Left Side: Brand Name & Logo */}
                <div
                    onClick={() => {
                        if (window.location.pathname !== "/") {
                            window.history.pushState({}, "", "/");
                            window.dispatchEvent(new PopStateEvent("popstate"));
                        }
                        window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="flex items-center gap-2.5 select-none cursor-pointer"
                >
                    <div className="w-12 h-12 rounded-xl bg-[#faf7f2] p-1 shadow-2xs border border-slate-200/80 flex items-center justify-center overflow-hidden">
                        <img
                            src="/logo/logo-2.png"
                            alt="cDocs Logo"
                            className="w-full h-full object-contain"
                        />
                    </div>
                    <span className="text-lg sm:text-xl font-bold tracking-tight text-brand-dark">
                        cDocs
                    </span>
                </div>

                {/* Right Side: Upload Button & User Badge / Sign In Button */}
                <div className="flex items-center gap-2 sm:gap-3">
                    {/* Upload Paper CTA Button */}
                    <button
                        type="button"
                        onClick={() => {
                            if (onNavigateUpload) {
                                onNavigateUpload();
                            } else {
                                window.history.pushState({}, "", "/upload");
                                window.dispatchEvent(new PopStateEvent("popstate"));
                            }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-accent hover:bg-amber-400 text-brand-dark text-xs sm:text-sm font-bold shadow-2xs transition-all cursor-pointer"
                    >
                        <span>Upload</span>
                        <span>📤</span>
                    </button>

                    {user ? (
                        <div className="hidden md:flex items-center gap-2 sm:gap-3">
                            {/* User Profile Badge (Desktop: Shows logo-4 avatar, @username, and registered email) */}
                            <div className="flex items-center gap-2.5 py-1 px-3 rounded-xl bg-slate-50 border border-slate-200">
                                <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-300 bg-[#27313d] flex items-center justify-center shrink-0 shadow-2xs">
                                    <img
                                        src="/logo/logo-4.png"
                                        alt="Profile Picture"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="flex flex-col text-left leading-tight min-w-0">
                                    <span className="text-xs font-bold text-slate-900 truncate max-w-[120px] sm:max-w-[170px]">
                                        @{user.username || "student"}
                                    </span>
                                    <span className="text-[10px] text-slate-500 truncate max-w-[120px] sm:max-w-[170px]" title={user.email}>
                                        {user.email}
                                    </span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={onSignOut}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 active:bg-rose-200/80 transition-colors border border-rose-200/60 cursor-pointer"
                                title="Sign Out"
                            >
                                <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                    />
                                </svg>
                                <span className="hidden sm:inline">Sign Out</span>
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onRequestAuth?.("Sign in to your cDocs account")}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-brand-dark bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition-colors border border-slate-300/80 cursor-pointer"
                        >
                            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                            </svg>
                            <span>Sign In</span>
                        </button>
                    )}

                    {/* Mobile Hamburger toggle */}
                    <button
                        type="button"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg"
                        aria-label="Toggle mobile menu"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isMobileMenuOpen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            )}
                        </svg>
                    </button>
                </div>
            </div>

            {/* Mobile Dropdown Menu */}
            {isMobileMenuOpen && (
                <div className="md:hidden border-t border-slate-200 px-4 pt-3 pb-4 space-y-2 bg-white">
                    <button
                        type="button"
                        onClick={() => {
                            setIsMobileMenuOpen(false);
                            if (onNavigateUpload) {
                                onNavigateUpload();
                            } else {
                                window.history.pushState({}, "", "/upload");
                                window.dispatchEvent(new PopStateEvent("popstate"));
                            }
                        }}
                        className="w-full py-2.5 px-3 text-xs font-bold text-brand-dark bg-accent hover:bg-amber-400 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                    >
                        <span>Upload Question Paper</span>
                        <span>📤</span>
                    </button>

                    <div className="pt-2 flex flex-col gap-2">
                        {user ? (
                            <div className="flex flex-col gap-2">
                                {/* Mobile User Account Details */}
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-full overflow-hidden border border-slate-300 bg-[#27313d] flex items-center justify-center shrink-0 shadow-2xs">
                                        <img
                                            src="/logo/logo-4.png"
                                            alt="Profile Picture"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="flex flex-col min-w-0 text-left">
                                        <span className="text-xs font-bold text-slate-900 truncate">
                                            @{user.username || "student"}
                                        </span>
                                        <span className="text-[11px] text-slate-500 truncate" title={user.email}>
                                            {user.email}
                                        </span>
                                        <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 mt-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                            Active Student Session
                                        </span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        onSignOut();
                                    }}
                                    className="w-full py-2.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-center border border-rose-200/60 cursor-pointer"
                                >
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setIsMobileMenuOpen(false);
                                    onRequestAuth?.("Sign in to your cDocs account");
                                }}
                                className="w-full py-2 text-xs font-semibold text-brand-dark bg-slate-100 rounded-xl text-center"
                            >
                                Sign In
                            </button>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
};

export default Navbar;
