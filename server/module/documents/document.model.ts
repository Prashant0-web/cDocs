import mongoose from "mongoose";
import { COLLECTION_CONSTANT } from "../../constant/db-collection.constant.js";
import "../user/user.model.js";

const { Schema } = mongoose;

export interface IDocumentPage {
    pageNumber: number;
    key: string;
    url: string;
    contentType: string;
    size: number;
    width?: number | undefined;
    height?: number | undefined;
}

export interface IDocument {
    title: string;
    subject?: string;
    subjectCode?: string;
    college?: string;
    course?: string;
    semester?: string;
    examYear?: string;
    examType?: string;
    topCode?: string;
    paperCode?: string;
    tags?: string[];
    contentHash?: string;
    pdfUrl?: string;
    pdfKey?: string;
    pdfSize?: number;
    thumbnailUrl?: string;
    thumbnailKey?: string;
    pages: IDocumentPage[];
    totalPages: number;
    stats?: {
        originalSizeBytes: number;
        compressedSizeBytes: number;
        savingsPercent: string;
    };
    created_by?: mongoose.Types.ObjectId | null;
    status: "active" | "flagged" | "archived";
    views: number;
    downloads: number;
    createdAt?: Date;
    updatedAt?: Date;
}

const documentPageSchema = new Schema<IDocumentPage>(
    {
        pageNumber: { type: Number, required: true },
        key: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        contentType: { type: String, required: true, trim: true },
        size: { type: Number, required: true },
        width: { type: Number, required: false },
        height: { type: Number, required: false },
    },
    { _id: false }
);

const documentSchema = new Schema<IDocument>(
    {
        title: { type: String, required: true, trim: true },
        subject: { type: String, required: false, trim: true },
        subjectCode: { type: String, required: false, trim: true },
        college: { type: String, required: false, trim: true },
        course: { type: String, required: false, trim: true },
        semester: { type: String, required: false, trim: true },
        examYear: { type: String, required: false, trim: true },
        examType: {
            type: String,
            enum: ["mid-sem", "end-sem", "quiz", "notes", "assignment", "other"],
            default: "end-sem",
        },
        topCode: { type: String, required: false, trim: true },
        paperCode: { type: String, required: false, trim: true },
        tags: { type: [String], default: [] },
        contentHash: { type: String, required: false, trim: true },
        pdfUrl: { type: String, required: false, trim: true },
        pdfKey: { type: String, required: false, trim: true },
        pdfSize: { type: Number, required: false },
        thumbnailUrl: { type: String, required: false, trim: true },
        thumbnailKey: { type: String, required: false, trim: true },
        pages: { type: [documentPageSchema], default: [] },
        totalPages: { type: Number, default: 1 },
        stats: {
            originalSizeBytes: { type: Number, required: false },
            compressedSizeBytes: { type: Number, required: false },
            savingsPercent: { type: String, required: false },
        },
        created_by: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: false,
            default: null,
        },
        status: {
            type: String,
            enum: ["active", "flagged", "archived"],
            default: "active",
        },
        views: { type: Number, default: 0 },
        downloads: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// Indexes for fast searching across college, subject code, exam codes, and tags
documentSchema.index({ subjectCode: 1, college: 1, examYear: 1 });
documentSchema.index({ topCode: 1 });
documentSchema.index({ paperCode: 1 });
documentSchema.index({ tags: 1 });
documentSchema.index({ contentHash: 1 });
documentSchema.index({ title: "text", subject: "text" });

const DocumentModel = mongoose.model<IDocument>(
    "Document",
    documentSchema,
    COLLECTION_CONSTANT.DOCUMENTS
);

export default DocumentModel;
