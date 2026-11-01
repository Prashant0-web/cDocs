import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { getAuthToken } from "../utils/cookie.util";

// Automatically resolve API_URL:
// 1. If VITE_API_URL is provided in environment (e.g. Vercel, Netlify, production domain), use it!
// 2. If testing over local LAN on phone (e.g. 192.168.1.11), use that host.
// 3. Fallback to localhost:3000.
const getApiBaseUrl = (): string => {
    const envUrl = (import.meta as any).env?.VITE_API_URL;
    if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
        return envUrl.trim().replace(/\/+$/, "");
    }

    if (typeof window !== "undefined" && window.location && window.location.hostname) {
        const host = window.location.hostname;
        if (/^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host)) {
            return `http://${host}:3000`;
        }
    }

    return "http://localhost:3000";
};

const API_URL = getApiBaseUrl();

// 1. Axios Instance create karo
const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 60000,
});

// 2. Request Interceptor: Har request me automatically JWT token attach karne ke liye
apiClient.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => Promise.reject(error));

// 3. Generic Types ka use (No 'any' or 'Object')
// T = Payload ka type, R = Response ka type
export const post = async <T, R>(endPoint: string, payload: T): Promise<R> => {
    try {
        const res = await apiClient.post<R>(endPoint, payload);
        return res.data;
    } catch (error) {
        // Safe error handling without using 'any'
        if (axios.isAxiosError(error) && error.response) {
            throw error.response.data; // Throw karna better hai taaki UI me try/catch kaam kare
        }
        throw new Error("An unexpected error occurred");
    }
}

export const get = async <R = unknown>(endPoint: string, config?: AxiosRequestConfig): Promise<R> => {
    try {
        const res = await apiClient.get<R>(endPoint, config);
        return res.data;
    } catch (error) {
        // Safe error handling without using 'any'
        if (axios.isAxiosError(error) && error.response) {
            throw error.response.data; // Throw karna better hai taaki UI me try/catch kaam kare
        }
        throw new Error("An unexpected error occurred");
    }
}

export const patch = async <T, R>(endPoint: string, payload: T): Promise<R> => {
    try {
        const res = await apiClient.patch<R>(endPoint, payload);
        return res.data;
    } catch (error) {
        // Safe error handling without using 'any'
        if (axios.isAxiosError(error) && error.response) {
            throw error.response.data; // Throw karna better hai taaki UI me try/catch kaam kare
        }
        throw new Error("An unexpected error occurred");
    }
}

export const uploadMultipart = async <R = unknown>(endPoint: string, formData: FormData): Promise<R> => {
    try {
        const token = getAuthToken();
        const res = await axios.post<R>(`${API_URL}${endPoint}`, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            timeout: 60000, // 60s for compression & Cloudflare upload
        });
        return res.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            throw error.response.data;
        }
        throw new Error("An unexpected error occurred during upload");
    }
}