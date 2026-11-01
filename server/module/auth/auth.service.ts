import type { Request, Response } from "express";
import crypto from "node:crypto";
import User from "../user/user.model.js";
import { sendOTPEmail } from "../../shared/email.service.js";
import { generateAuthToken } from "../../shared/token.service.js";

const signIn = async (req: Request, res: Response): Promise<any> => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found. Please Sign up first.' });

        // 6-digit OTP (100000 se 999999)
        const otp = crypto.randomInt(100000, 1000000);
        console.log(`🔐 [Sign-In OTP for ${email}]: ${otp}`);

        // IMPORTANT: OTP ko database me update karo taaki verify kar sako
        user.otp = String(otp);
        await user.save();

        try {
            await sendOTPEmail(email, String(otp));
        } catch (mailError: any) {
            console.error(`⚠️ Failed to send Sign-In OTP email to ${email}:`, mailError?.message);
            return res.status(502).json({
                error: `Failed to deliver OTP to ${email}: ${mailError?.message || "Email service timeout"}. Please check server SMTP credentials or logs.`,
            });
        }

        return res.status(200).json({ code: 200, message: "OTP Sent Successfully" });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

const signUp = async (req: Request, res: Response): Promise<any> => {
    try {
        const { email, username } = req.body;

        // 1. Alag function se Username Validation call karo
        const usernameCheck = validateUsernameFormat(username);
        if (!usernameCheck.isValid) {
            return res.status(400).json({ error: usernameCheck.error });
        }

        if (!email) return res.status(400).json({ error: 'Email is required' });

        // 2. Database Validation (Check if email OR username already exists)
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });

        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ error: 'User with this email already exists' });
            }
            if (existingUser.username === username) {
                return res.status(400).json({ error: 'Username is already taken, try another one' });
            }
        }

        // 3. OTP Generate aur Save karo
        const otp = crypto.randomInt(100000, 1000000);
        console.log(`🔐 [Sign-Up OTP for ${email}]: ${otp}`);

        await User.create({ email, username, otp: String(otp) });

        try {
            await sendOTPEmail(email, String(otp));
        } catch (mailError: any) {
            console.error(`⚠️ Failed to send Sign-Up OTP email to ${email}:`, mailError?.message);
            return res.status(502).json({
                error: `Failed to deliver OTP to ${email}: ${mailError?.message || "Email service timeout"}. Please check server SMTP credentials or logs.`,
            });
        }

        return res.status(200).json({ status: 200, message: "OTP Sent Successfully" });

    } catch (error: any) {
        return res.status(500).json({ status: 500, error: error.message });
    }
}

const verifyOTP = async (req: Request, res: Response): Promise<any> => {
    try {
        // Body se data lo, params se nahi
        const { email, otp } = req.body;

        if (!otp || !email) return res.status(400).json({ status: 400, error: 'Email and OTP are required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // OTP match check karo
        if (user.otp !== String(otp)) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // OTP verify hone ke baad DB se hata do (taaki wahi OTP dobara use na ho sake)
        user.otp = ''; // ya empty string
        await user.save();

        // Genrate token 
        const token = generateAuthToken(user._id.toString(), user.role);

        return res.status(200).json({ status: 200, message: "OTP Verified Successfully", user, token });
    } catch (error: any) {
        return res.status(500).json({ status: 500, error: error.message });
    }
}

// Is function ko aap util/helpers wali file me bhi rakh sakte ho
const validateUsernameFormat = (username: string): { isValid: boolean; error?: string } => {
    if (!username) {
        return { isValid: false, error: 'Username is required' };
    }

    // Sirf letters, numbers aur underscore allow karega. No spaces, minimum 3 chars.
    const usernameRegex = /^[a-zA-Z0-9_.@#]{3,}$/;

    if (!usernameRegex.test(username)) {
        return {
            isValid: false,
            error: 'Username must be at least 3 characters long and contain no spaces or special characters (except underscore)'
        };
    }

    return { isValid: true };
};

const checkUsername = async (req: Request, res: Response): Promise<any> => {
    try {
        const username = req.body?.username || req.query?.username;

        if (!username) {
            return res.status(400).json({ isValid: false, available: false, error: 'Username is required' });
        }

        const formatCheck = validateUsernameFormat(String(username));
        if (!formatCheck.isValid) {
            return res.status(400).json({
                isValid: false,
                available: false,
                error: formatCheck.error
            });
        }

        const existingUser = await User.findOne({ username: String(username).trim() });
        if (existingUser) {
            return res.status(200).json({
                isValid: true,
                available: false,
                error: 'Username is already taken, try another one'
            });
        }

        return res.status(200).json({
            isValid: true,
            available: true,
            message: 'Username is available'
        });
    } catch (error: any) {
        return res.status(500).json({ status: 500, error: error.message });
    }
};

// verifyOTP aur checkUsername ko export karna
export default { signIn, signUp, verifyOTP, checkUsername };