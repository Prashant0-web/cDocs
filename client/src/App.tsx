import { useState, useEffect } from "react";
import "./App.css";
import { Home } from "./app/home/Home";
import { Privacy } from "./app/privacy/Privacy";
import {
    getAuthToken,
    getAuthUser,
    clearAuthSession,
    type StoredUser,
} from "./utils/cookie.util";

function App() {
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const getInitialRoute = (): "home" | "privacy" => {
        if (typeof window !== "undefined") {
            const p = window.location.pathname.toLowerCase();
            const h = window.location.hash.toLowerCase();
            if (p === "/privacy" || p === "/terms" || h === "#privacy" || h === "#terms") {
                return "privacy";
            }
        }
        return "home";
    };

    const [currentRoute, setCurrentRoute] = useState<"home" | "privacy">(getInitialRoute());

    // Listen to browser history navigation (back/forward)
    useEffect(() => {
        const handlePopState = () => {
            const p = window.location.pathname.toLowerCase();
            const h = window.location.hash.toLowerCase();
            if (p === "/privacy" || p === "/terms" || h === "#privacy" || h === "#terms") {
                setCurrentRoute("privacy");
            } else {
                setCurrentRoute("home");
            }
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const navigateTo = (route: "home" | "privacy") => {
        setCurrentRoute(route);
        const path = route === "privacy" ? "/privacy" : "/";
        if (window.location.pathname !== path) {
            window.history.pushState({}, "", path);
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
                    Loading...
                </div>
            </div>
        );
    }

    if (currentRoute === "privacy") {
        return (
            <Privacy
                user={currentUser}
                onNavigateHome={() => navigateTo("home")}
                onSignOut={handleSignOut}
                onRequestAuth={() => navigateTo("home")}
            />
        );
    }

    return (
        <Home
            user={currentUser}
            onSignOut={handleSignOut}
            onAuthSuccess={handleAuthSuccess}
            onNavigatePrivacy={() => navigateTo("privacy")}
        />
    );
}

export default App;
