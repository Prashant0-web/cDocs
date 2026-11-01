import "dotenv/config"
import express from "express";
import { mongooseConnect } from "./database/connection.db.js";
import cors from "cors";
import authRouter from "./module/auth/auth.route.js";
import documentRouter from "./module/documents/document.route.js";
import "./module/user/user.model.js";

const app = express();
mongooseConnect();

const isProduction = process.env.NODE_ENV === "production";

// Production Whitelist (Secure HTTPS only)
const productionOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.FRONTEND_URL,
    "https://cdocs.prashantbuilds.com",
].filter(Boolean) as string[];

// Local Development & Testing Whitelist (Active ONLY when NODE_ENV !== "production")
const developmentOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
    "http://192.168.1.11:5173",
    "http://192.168.1.11:5174",
];

const allowedOrigins = isProduction
    ? productionOrigins
    : [...productionOrigins, ...developmentOrigins];

const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        // Allow non-browser requests (mobile native apps, curl, Postman, or server-to-server)
        if (!origin || origin === "null") {
            return callback(null, true);
        }

        // Whitelist exact matches (including CLIENT_ORIGIN and https://cdocs.prashantbuilds.com)
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Automatically allow any secure subdomain of prashantbuilds.com or Vercel preview deployment
        if (
            /^https:\/\/([a-z0-9-]+\.)*prashantbuilds\.com$/.test(origin) ||
            /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(origin)
        ) {
            return callback(null, true);
        }

        // In Local Development mode: allow local LAN IPs and localhost
        if (!isProduction) {
            if (
                /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin) ||
                /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin) ||
                /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
                /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
            ) {
                return callback(null, true);
            }
            return callback(null, true); // Permissive dev fallback
        }

        // In Production: reject any unauthorized foreign origin
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
};

app.use(cors(corsOptions));

app.use(express.json());

// Auth Routes
app.use('/auth', authRouter);

// Document Management & Cloudflare R2 Routes
app.use('/documents', documentRouter);

app.use((req, res) => {
    console.log("👉 Server ke andar request aayi:", req.method, req.url, "from origin:", req.headers.origin);
    return res.status(200).json({ message: "Welcome back, Prashant! Server working." });
});

const server = (PORT: number) => {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server started on port ${PORT} (listening on 0.0.0.0)`);
    });
};

const PORT = Number(process.env.PORT) || 3000;
server(PORT);