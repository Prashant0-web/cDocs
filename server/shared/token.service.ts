import jwt from "jsonwebtoken";

export const generateAuthToken = (userId: string, role: string): string => {
    const secret = process.env.JWT_SECRET as string;

    // Token 7 din ke liye valid rahega
    return jwt.sign({ userId, role }, secret, { expiresIn: '7d' });
};