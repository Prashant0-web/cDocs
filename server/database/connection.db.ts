import mongoose from "mongoose";

export const mongooseConnect = async () => {
    try {
        const isValidMongoUri = (val?: string) =>
            typeof val === "string" && (val.startsWith("mongodb://") || val.startsWith("mongodb+srv://"));

        const uri =
            [process.env.MONGODB_URI, process.env.CONNECTION_URI, process.env.MONGO_URI].find(isValidMongoUri) ||
            "mongodb://localhost:27017/cdocs";

        await mongoose.connect(uri);
        console.log("DB Connected!");
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
};