import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { post } from "../../services/api.service";
import { setAuthSession } from "../../utils/cookie.util";
import type { StoredUser } from "../../utils/cookie.util";

// Username format validation synced with server/module/auth/auth.service.ts:L94-L111
export const validateUsernameFormat = (
    username: string
): { isValid: boolean; error?: string } => {
    if (!username) {
        return { isValid: false, error: "Username is required" };
    }

    // Sirf letters, numbers aur underscore allow karega. No spaces, minimum 3 chars.
    const usernameRegex = /^[a-zA-Z0-9_.@#]{3,}$/;

    if (!usernameRegex.test(username)) {
        return {
            isValid: false,
            error: "Username must be at least 3 characters long and contain no spaces or special characters (except underscore)",
        };
    }

    return { isValid: true };
};

// Zod validation schema (supports both sign-up and sign-in)
const authSchema = z.object({
    email: z
        .string()
        .min(1, "Email address is required")
        .email("Please enter a valid email address (e.g. name@example.com)"),
    username: z.string().optional(),
    otp: z.string().optional(),
});

type AuthFormData = z.infer<typeof authSchema>;

interface ApiSuccessResponse {
    status?: number;
    code?: number;
    message?: string;
    token?: string;
    user?: StoredUser;
}

interface ApiErrorResponse {
    error?: string;
    message?: string;
}

interface CheckUsernameResponse {
    isValid: boolean;
    available: boolean;
    message?: string;
    error?: string;
}

interface UsernameStatus {
    state: "idle" | "checking" | "available" | "taken" | "invalid";
    message?: string;
}

interface AuthProps {
    onAuthSuccess?: (user: StoredUser, token: string) => void;
    onClose?: () => void;
    isModal?: boolean;
    initialMode?: "signin" | "signup";
}

export const SignUp: React.FC<AuthProps> = ({
    onAuthSuccess,
    onClose,
    isModal = false,
    initialMode = "signin",
}) => {
    // Mode can be 'signup' or 'signin'
    const [mode, setMode] = useState<"signup" | "signin">(initialMode);
    const [step, setStep] = useState<"details" | "otp">("details");
    const [serverMessage, setServerMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);
    const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
    const [usernameTouched, setUsernameTouched] = useState<boolean>(false);

    // Backend debounced validation state for username
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
        state: "idle",
    });

    const {
        register,
        handleSubmit,
        trigger,
        getValues,
        setValue,
        setError,
        clearErrors,
        setFocus,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<AuthFormData>({
        resolver: zodResolver(authSchema),
        mode: "onChange",
        defaultValues: {
            email: "",
            username: "",
            otp: "",
        },
    });

    const usernameValue = watch("username") || "";
    const emailValue = watch("email") || "";

    // Switch between Sign Up and Sign In modes
    const switchMode = (newMode: "signup" | "signin") => {
        setMode(newMode);
        setStep("details");
        setServerMessage(null);
        setValue("otp", "");
        clearErrors();
        setUsernameStatus({ state: "idle" });
        setUsernameTouched(false);
    };

    // Debounced Backend Username Validation (only runs in signup mode)
    useEffect(() => {
        if (mode !== "signup") {
            setUsernameStatus({ state: "idle" });
            return;
        }

        const trimmed = usernameValue.trim();

        if (trimmed.length === 0) {
            setUsernameStatus({ state: "idle" });
            return;
        }

        if (trimmed.length < 3) {
            setUsernameStatus({
                state: "invalid",
                message: usernameTouched
                    ? "Username must be at least 3 characters long"
                    : undefined,
            });
            return;
        }

        // Check format locally first
        const formatCheck = validateUsernameFormat(trimmed);
        if (!formatCheck.isValid) {
            setUsernameStatus({
                state: "invalid",
                message: formatCheck.error,
            });
            return;
        }

        // Format is valid -> show checking status and trigger debounced API call
        setUsernameStatus({
            state: "checking",
            message: "Checking availability...",
        });

        const timer = setTimeout(async () => {
            try {
                const res = await post<
                    { username: string },
                    CheckUsernameResponse
                >("/auth/check-username", { username: trimmed });

                if (res.available) {
                    setUsernameStatus({
                        state: "available",
                        message: res.message || "Username is available",
                    });
                } else {
                    setUsernameStatus({
                        state: "taken",
                        message:
                            res.error ||
                            "Username is already taken, try another one",
                    });
                }
            } catch (err: unknown) {
                const apiError = err as ApiErrorResponse;
                setUsernameStatus({
                    state: "taken",
                    message:
                        apiError?.error ||
                        apiError?.message ||
                        "Username is already taken, try another one",
                });
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [usernameValue, usernameTouched, mode]);

    const isUsernameAvailable = usernameStatus.state === "available";
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim());

    // Send OTP button disabled logic:
    // - For Sign In: depends only on email
    // - For Sign Up: depends on email + backend-verified username
    const isSendOtpDisabled =
        !isEmailValid ||
        isRequestingOtp ||
        (mode === "signup" &&
            (!isUsernameAvailable || usernameStatus.state === "checking"));

    // Step 1: Request OTP from backend (/auth/sign-up or /auth/sign-in)
    const handleRequestOtp = async () => {
        setServerMessage(null);
        const isEmailOk = await trigger("email");

        if (!isEmailOk) return;

        if (mode === "signup") {
            const isUsernameOk = await trigger("username");
            if (!isUsernameOk || !isUsernameAvailable) {
                return;
            }
        }

        const { email, username } = getValues();
        setIsRequestingOtp(true);

        try {
            if (mode === "signup") {
                const response = await post<
                    { email: string; username: string },
                    ApiSuccessResponse
                >("/auth/sign-up", { email, username: username || "" });
                setServerMessage({
                    type: "success",
                    text:
                        response.message ||
                        "OTP has been sent to your email address!",
                });
            } else {
                const response = await post<
                    { email: string },
                    ApiSuccessResponse
                >("/auth/sign-in", { email });
                setServerMessage({
                    type: "success",
                    text:
                        response.message ||
                        "OTP has been sent to your email address!",
                });
            }

            setStep("otp");
            setTimeout(() => setFocus("otp"), 100);
        } catch (err) {
            const apiError = err as ApiErrorResponse;
            const errMsg =
                apiError?.error ||
                apiError?.message ||
                "Failed to send OTP. Please check your details.";
            setError("email", {
                type: "manual",
                message: errMsg,
            });
            setServerMessage(null);
        } finally {
            setIsRequestingOtp(false);
        }
    };

    // Step 2: Final submission / OTP Verification (/auth/verify-otp)
    const onSubmit = async (data: AuthFormData) => {
        setServerMessage(null);

        // If in details step, request OTP
        if (step === "details") {
            await handleRequestOtp();
            return;
        }

        // Validate OTP input
        if (!data.otp || data.otp.trim().length !== 6) {
            setError("otp", {
                type: "manual",
                message: "Please enter the 6-digit OTP code",
            });
            return;
        }

        try {
            const response = await post<{ email: string; otp: string }, ApiSuccessResponse>(
                "/auth/verify-otp",
                { email: data.email, otp: data.otp }
            );

            if (response.token && response.user) {
                // Save token & user safely in cookies and localStorage
                setAuthSession(response.token, response.user);

                if (onAuthSuccess) {
                    onAuthSuccess(response.user, response.token);
                    return;
                }
            } else if (response.token) {
                localStorage.setItem("token", response.token);
            }

            setServerMessage({
                type: "success",
                text:
                    response.message ||
                    (mode === "signup"
                        ? "Account verified successfully! Welcome aboard."
                        : "Signed in successfully! Welcome back."),
            });
        } catch (err) {
            const apiError = err as ApiErrorResponse;
            const errorText =
                apiError?.error ||
                apiError?.message ||
                "Invalid OTP";
            setError("otp", {
                type: "manual",
                message: errorText,
            });
            setServerMessage(null);
        }
    };

    const content = (
        <div className={`w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 transition-all relative ${isModal ? "border border-slate-200/90 shadow-2xl" : ""}`}>
            {/* Close Button when rendered as modal */}
            {onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center text-sm transition-colors cursor-pointer"
                    aria-label="Close"
                >
                    ✕
                </button>
            )}

            {/* Brand Header with Logo */}
            <div className="flex flex-col items-center text-center mb-5">
                <div className="w-16 h-16 rounded-2xl bg-[#faf7f2] p-2 shadow-xs border border-slate-200/80 flex items-center justify-center overflow-hidden mb-2.5">
                    <img
                        src="/logo/logo-2.png"
                        alt="cDocs Logo"
                        className="w-full h-full object-contain"
                    />
                </div>

                <h1 className="text-2xl font-bold tracking-tight text-brand-dark mb-1">
                    cDocs
                </h1>

                <p className="text-xs sm:text-sm text-slate-500">
                    {step === "otp"
                        ? "Enter the verification code sent to your email"
                        : mode === "signup"
                        ? "Create an account to search and upload exam papers"
                        : "Sign in with your email to access papers and docs"}
                </p>
            </div>

                {/* Mode Selector Tabs (Sign Up / Sign In) */}
                <div className="flex p-1 bg-slate-100 rounded-xl mb-5 border border-slate-200/60">
                    <button
                        type="button"
                        onClick={() => switchMode("signup")}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                            mode === "signup"
                                ? "bg-white text-brand-dark shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                        Sign Up
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode("signin")}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                            mode === "signin"
                                ? "bg-white text-brand-dark shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                        Sign In
                    </button>
                </div>

                {/* Success Notification */}
                {serverMessage && serverMessage.type === "success" && (
                    <div
                        role="alert"
                        className="mb-4 p-3 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium transition-all"
                    >
                        {serverMessage.text}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                    {/* Email Field */}
                    <div>
                        <label
                            htmlFor="email"
                            className="block text-sm font-semibold text-slate-700 mb-1"
                        >
                            Email Address
                        </label>
                        <span id="email-hint" className="block text-xs text-slate-500 mb-1">
                            Enter the email address you'll use to log in
                        </span>
                        <div className="relative">
                            <input
                                id="email"
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                autoCorrect="off"
                                autoCapitalize="none"
                                placeholder="name@example.com"
                                aria-describedby="email-hint"
                                aria-invalid={errors.email ? "true" : "false"}
                                {...register("email", {
                                    onChange: () => {
                                        if (step === "otp") {
                                            setStep("details");
                                            setValue("otp", "");
                                        }
                                    },
                                })}
                                className={`w-full px-3.5 py-2.5 rounded-xl border text-slate-800 bg-white placeholder-slate-400 text-sm transition-colors duration-150 outline-none ${
                                    errors.email
                                        ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
                                        : isEmailValid
                                        ? "border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        : "border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-light"
                                }`}
                            />
                        </div>
                        {/* Error message without danger icon */}
                        {errors.email && (
                            <p className="mt-1 text-xs text-rose-600 font-medium">
                                {errors.email.message}
                            </p>
                        )}
                    </div>

                    {/* Username Field - ONLY shown in Sign Up mode */}
                    {mode === "signup" && (
                        <div>
                            <label
                                htmlFor="username"
                                className="block text-sm font-semibold text-slate-700 mb-1"
                            >
                                Username
                            </label>
                            <span
                                id="username-hint"
                                className="block text-xs text-slate-500 mb-1"
                            >
                                At least 3 characters (letters, numbers, _, ., @, #)
                            </span>
                            <div className="relative">
                                <input
                                    id="username"
                                    type="text"
                                    autoComplete="username"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    placeholder="e.g. alex_99"
                                    aria-describedby="username-hint"
                                    aria-invalid={
                                        usernameStatus.state === "invalid" ||
                                        usernameStatus.state === "taken" ||
                                        !!errors.username
                                            ? "true"
                                            : "false"
                                    }
                                    {...register("username", {
                                        onChange: () => {
                                            if (!usernameTouched) setUsernameTouched(true);
                                            if (step === "otp") {
                                                setStep("details");
                                                setValue("otp", "");
                                            }
                                        },
                                        onBlur: () => {
                                            setUsernameTouched(true);
                                        },
                                    })}
                                    className={`w-full px-3.5 py-2.5 rounded-xl border text-slate-800 bg-white placeholder-slate-400 text-sm transition-colors duration-150 outline-none ${
                                        usernameStatus.state === "invalid" ||
                                        usernameStatus.state === "taken" ||
                                        errors.username
                                            ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
                                            : usernameStatus.state === "available"
                                            ? "border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                            : usernameStatus.state === "checking"
                                            ? "border-brand/60 focus:border-brand focus:ring-2 focus:ring-brand-light"
                                            : "border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-light"
                                    }`}
                                />
                            </div>

                            {/* Checking state with mini spinner */}
                            {usernameStatus.state === "checking" && (
                                <p className="mt-1 text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                    <svg
                                        className="animate-spin h-3.5 w-3.5 text-brand"
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
                                    Checking availability...
                                </p>
                            )}

                            {/* Available status (Success) */}
                            {usernameStatus.state === "available" && (
                                <p className="mt-1 text-xs text-emerald-600 font-medium">
                                    {usernameStatus.message || "Username is available"}
                                </p>
                            )}

                            {/* Taken / Invalid Error message (No danger icon) */}
                            {(usernameStatus.state === "taken" ||
                                usernameStatus.state === "invalid") &&
                                usernameStatus.message && (
                                    <p className="mt-1 text-xs text-rose-600 font-medium">
                                        {usernameStatus.message}
                                    </p>
                                )}
                        </div>
                    )}

                    {/* OTP Section (ONLY shown after OTP is sent) */}
                    {step === "otp" && (
                        <div className="pt-1 transition-all duration-300">
                            <div className="flex items-center justify-between mb-1">
                                <label
                                    htmlFor="otp"
                                    className="text-sm font-semibold text-slate-700"
                                >
                                    Verification Code (OTP)
                                </label>
                                <button
                                    type="button"
                                    onClick={handleRequestOtp}
                                    disabled={isRequestingOtp || isSubmitting}
                                    className="text-xs font-semibold text-brand hover:text-brand-dark transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    {isRequestingOtp ? "Resending..." : "Resend OTP"}
                                </button>
                            </div>
                            <span id="otp-hint" className="block text-xs text-slate-500 mb-1">
                                Enter the 6-digit code received on your email
                            </span>
                            <div className="relative">
                                <input
                                    id="otp"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    autoComplete="one-time-code"
                                    placeholder="6-digit OTP"
                                    aria-describedby="otp-hint"
                                    aria-invalid={errors.otp ? "true" : "false"}
                                    {...register("otp", {
                                        onChange: () => {
                                            if (errors.otp) clearErrors("otp");
                                        },
                                    })}
                                    className={`w-full px-3.5 py-2.5 rounded-xl border text-slate-800 bg-white placeholder-slate-400 tracking-widest text-sm font-mono transition-colors duration-150 outline-none ${
                                        errors.otp
                                            ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
                                            : "border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-light"
                                    }`}
                                />
                            </div>
                            {/* Error message without danger icon */}
                            {errors.otp && (
                                <p className="mt-1 text-xs text-rose-600 font-medium">
                                    {errors.otp.message}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-3 flex flex-col gap-2.5">
                        <button
                            type="submit"
                            disabled={
                                step === "otp"
                                    ? isSubmitting || isRequestingOtp
                                    : isSendOtpDisabled
                            }
                            className={`w-full py-3 px-4 rounded-xl font-semibold text-sm shadow-md transition-all duration-200 flex items-center justify-center gap-2 ${
                                (step === "details" && isSendOtpDisabled) ||
                                (step === "otp" && isSubmitting)
                                    ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                                    : "bg-brand hover:bg-brand-dark text-white cursor-pointer hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-light"
                            }`}
                        >
                            {isSubmitting || isRequestingOtp ? (
                                <>
                                    <svg
                                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
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
                                    {step === "otp" ? "Verifying..." : "Sending OTP..."}
                                </>
                            ) : step === "otp" ? (
                                mode === "signup"
                                    ? "Verify OTP & Complete Sign Up"
                                    : "Verify OTP & Sign In"
                            ) : (
                                "Send OTP"
                            )}
                        </button>
                    </div>
                </form>

                {/* Footer toggle info */}
                <div className="mt-6 pt-5 border-t border-slate-100 text-center">
                    <p className="text-xs text-slate-500">
                        {mode === "signup" ? (
                            <>
                                Already have an account?{" "}
                                <button
                                    type="button"
                                    onClick={() => switchMode("signin")}
                                    className="font-semibold text-brand hover:text-brand-dark transition-colors cursor-pointer"
                                >
                                    Sign In
                                </button>
                            </>
                        ) : (
                            <>
                                Don't have an account?{" "}
                                <button
                                    type="button"
                                    onClick={() => switchMode("signup")}
                                    className="font-semibold text-brand hover:text-brand-dark transition-colors cursor-pointer"
                                >
                                    Sign Up
                                </button>
                            </>
                        )}
                    </p>
                </div>
            </div>
    );

    if (isModal) {
        return (
            <div
                className="fixed inset-0 z-50 bg-brand-dark/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
                onClick={(e) => {
                    if (e.target === e.currentTarget && onClose) onClose();
                }}
            >
                {content}
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-white">
            {content}
        </div>
    );
};

export const Auth = SignUp;
export default SignUp;
