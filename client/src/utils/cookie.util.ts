import Cookies from "js-cookie";

export interface StoredUser {
    _id: string;
    username: string;
    email: string;
    role: string;
    createdAt?: string;
    updatedAt?: string;
}

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

/**
 * Saves token and user in cookies (7 days, SameSite=Lax)
 */
export const setAuthSession = (token: string, user: StoredUser) => {
    Cookies.set(TOKEN_KEY, token, {
        expires: 7,
        path: "/",
        sameSite: "Lax",
        secure: window.location.protocol === "https:",
    });

    Cookies.set(USER_KEY, JSON.stringify(user), {
        expires: 7,
        path: "/",
        sameSite: "Lax",
        secure: window.location.protocol === "https:",
    });

    // Local storage fallback
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
};

export const getAuthToken = (): string | undefined => {
    return Cookies.get(TOKEN_KEY) || localStorage.getItem("token") || undefined;
};

export const getAuthUser = (): StoredUser | null => {
    const userCookie = Cookies.get(USER_KEY);
    if (userCookie) {
        try {
            return JSON.parse(userCookie);
        } catch {
            // parse error fallback
        }
    }
    const userLocal = localStorage.getItem("user");
    if (userLocal) {
        try {
            return JSON.parse(userLocal);
        } catch {
            // parse error fallback
        }
    }
    return null;
};

export const clearAuthSession = () => {
    Cookies.remove(TOKEN_KEY, { path: "/" });
    Cookies.remove(USER_KEY, { path: "/" });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
};
