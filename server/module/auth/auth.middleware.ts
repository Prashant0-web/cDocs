import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Request ko extend kar rahe hain taaki req.user set kar sakein
export interface AuthRequest extends Request {
    user?: any;
}

export const authorize = (req: AuthRequest, res: Response, next: NextFunction): any => {
    try {
        const authHeader = req.headers.authorization;
        let token: string | undefined;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        } else if (typeof req.query.token === "string" && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ error: "Access Denied. No authentication token provided." });
        }

        const secret = (process.env.JWT_SECRET as string) || "your-default-secret";

        // Token verify karo
        const decoded = jwt.verify(token, secret);

        // Decoded data (userId, role) ko request me daal do taaki controllers use kar sakein
        req.user = decoded;

        next(); // Sab sahi hai toh next function/route par jao
    } catch (error) {
        return res.status(403).json({ error: "Invalid or expired token." });
    }
};