import { useState, useEffect } from "react";
import "./App.css";
import { Home } from "./app/home/Home";
import { Privacy } from "./app/privacy/Privacy";
import { UploadPage } from "./app/upload/UploadPage";
import { PaperDetail } from "./app/paper/PaperDetail";
import {
    getAuthToken,
    getAuthUser,
    clearAuthSession,
    type StoredUser,
} from "./utils/cookie.util";

export type AppRoute =
    | { type: "home" }
    | { type: "privacy" }
    | { type: "upload" }
    | { type: "paper"; paperId: string };

function parseCurrentLocation(): AppRoute {
    if (typeof window === "undefined") return { type: "home" };
    const p = window.location.pathname.toLowerCase();
    const h = window.location.hash.toLowerCase();

    if (p === "/privacy" || p === "/terms" || h === "#privacy" || h === "#terms") {
        return { type: "privacy" };
    }

    if (p === "/upload" || h === "#upload") {
        return { type: "upload" };
    }

    const paperMatch = window.location.pathname.match(/^\/(?:paper|document)\/([a-zA-Z0-9_-]+)/i);
    if (paperMatch && paperMatch[1]) {
        return { type: "paper", paperId: paperMatch[1] };
    }

    return { type: "home" };
}

function App() {
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [currentRoute, setCurrentRoute] = useState<AppRoute>(parseCurrentLocation());

    // Listen to browser history navigation (back/forward)
    useEffect(() => {
        const handlePopState = () => {
            setCurrentRoute(parseCurrentLocation());
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const navigateToHome = () => {
        setCurrentRoute({ type: "home" });
        if (window.location.pathname !== "/") {
            window.history.pushState({}, "", "/");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const navigateToPrivacy = () => {
        setCurrentRoute({ type: "privacy" });
        if (window.location.pathname !== "/privacy") {
            window.history.pushState({}, "", "/privacy");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const navigateToUpload = () => {
        setCurrentRoute({ type: "upload" });
        if (window.location.pathname !== "/upload") {
            window.history.pushState({}, "", "/upload");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const navigateToPaper = (paperId: string) => {
        setCurrentRoute({ type: "paper", paperId });
        const targetPath = `/paper/${paperId}`;
        if (window.location.pathname !== targetPath) {
            window.history.pushState({}, "", targetPath);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // Check existing session from cookies on initial load
    useEffect(() => {
        const token = getAuthToken();
        const user = getAuthUser();

        if (token && user) {
            setCurrentUser(user);
        } else {
            setCurrentUser(null);
        }
        setIsLoading(false);
    }, []);

    const handleAuthSuccess = (user: StoredUser) => {
        setCurrentUser(user);
    };

    const handleSignOut = () => {
        clearAuthSession();
        setCurrentUser(null);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <svg
                        className="animate-spin h-5 w-5 text-brand"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        ></circle>
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                    </svg>
                    Loading cDocs...
                </div>
            </div>
        );
    }

    if (currentRoute.type === "privacy") {
        return (
            <Privacy
                user={currentUser}
                onNavigateHome={navigateToHome}
                onSignOut={handleSignOut}
                onRequestAuth={() => navigateToHome()}
            />
        );
    }

    if (currentRoute.type === "upload") {
        return (
            <UploadPage
                user={currentUser}
                onNavigateHome={navigateToHome}
                onNavigatePaper={navigateToPaper}
                onSignOut={handleSignOut}
                onRequestAuth={() => navigateToHome()}
            />
        );
    }

    if (currentRoute.type === "paper") {
        return (
            <PaperDetail
                paperId={currentRoute.paperId}
                user={currentUser}
                onNavigateHome={navigateToHome}
                onSignOut={handleSignOut}
                onRequestAuth={() => navigateToHome()}
            />
        );
    }

    return (
        <Home
            user={currentUser}
            onSignOut={handleSignOut}
            onAuthSuccess={handleAuthSuccess}
            onNavigatePrivacy={navigateToPrivacy}
            onNavigateUpload={navigateToUpload}
            onNavigatePaper={navigateToPaper}
        />
    );
}

export default App;
