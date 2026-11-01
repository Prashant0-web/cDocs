import nodemailer from "nodemailer";

// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
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