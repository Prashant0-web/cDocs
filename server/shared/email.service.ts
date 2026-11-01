import nodemailer from "nodemailer";

const getCleanEnv = (val?: string) => (val || "").replace(/['"]/g, "").trim();

// Create an enterprise-grade SMTP transporter for Gmail on port 465 (SSL)
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // Port 465 uses SSL direct
    auth: {
        user: getCleanEnv(process.env.SMTP_USER),
        pass: getCleanEnv(process.env.SMTP_PASS),
    },
    connectionTimeout: 8000, // 8 seconds timeout - never hang forever
    greetingTimeout: 8000,
    socketTimeout: 10000,
});


export const sendOTPEmail = async (toEmail: string, otp: string) => {
    try {
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: toEmail,
            subject: `Sign-In Opt for ${process.env.ORG_NAME}`,
            text: `Your OTP is : ${otp}`,
            html: `
                <h3>Welcome back, Prashant!</h3>
                <p>Your OTP for signing in is: <strong>${otp}</strong></p>
                <p>This code is valid for 5 minutes. Please do not share it with anyone.</p>
            `
        }

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${toEmail} with OTP: ${otp}`)
    } catch (error: any) {
        console.log(`Error sending OTP to ${toEmail}: ${error.message}`)
        throw error;
    }
}