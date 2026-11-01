import nodemailer from "nodemailer";

const getCleanEnv = (val?: string) => (val || "").replace(/['"]/g, "").trim();

// Enterprise-grade SMTP transporter for local development / servers with open ports
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: getCleanEnv(process.env.SMTP_USER),
        pass: getCleanEnv(process.env.SMTP_PASS),
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
});

export const sendOTPEmail = async (toEmail: string, otp: string) => {
    const resendApiKey = getCleanEnv(process.env.RESEND_API_KEY);
    const orgName = process.env.ORG_NAME || "cDocs";
    const subject = `Your Verification OTP for ${orgName}`;
    const htmlContent = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <h2 style="color: #0f172a; margin-top: 0;">Welcome to ${orgName}!</h2>
            <p style="color: #475569; font-size: 15px;">Your one-time verification code (OTP) is:</p>
            <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7;">${otp}</span>
            </div>
            <p style="color: #64748b; font-size: 13px;">This code is valid for 5 minutes. Please do not share it with anyone.</p>
        </div>
    `;

    // 1. If RESEND_API_KEY is available (Production HTTPS Port 443 - Never blocked on Render)
    if (resendApiKey) {
        try {
            const fromEmail =
                (process.env.RESEND_FROM || "").trim().replace(/^["']|["']$/g, "") ||
                "cDocs <onboarding@resend.dev>";
            const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: fromEmail,
                    to: toEmail,
                    subject,
                    html: htmlContent,
                }),
            });

            const data = (await res.json()) as any;
            if (!res.ok) {
                throw new Error(data?.message || `Resend error: ${res.statusText}`);
            }

            console.log(`✅ [Resend HTTPS] Email delivered to ${toEmail} with OTP: ${otp} (ID: ${data.id})`);
            return;
        } catch (error: any) {
            console.error(`⚠️ Resend HTTPS delivery error to ${toEmail}:`, error.message);
            throw error;
        }
    }

    // 2. Fallback to Nodemailer SMTP (Local development)
    try {
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: toEmail,
            subject,
            text: `Your OTP is: ${otp}`,
            html: htmlContent,
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ [Nodemailer SMTP] Email sent to ${toEmail} with OTP: ${otp}`);
    } catch (error: any) {
        console.error(`Error sending OTP to ${toEmail} via SMTP: ${error.message}`);
        throw error;
    }
};