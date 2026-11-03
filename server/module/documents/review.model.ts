import mongoose, { Schema, Document } from "mongoose";
import { COLLECTION_CONSTANT } from "../../constant/db-collection.constant.js";
import "../user/user.model.js";
import "./document.model.js";

export interface IDocumentReview extends Document {
    documentId: mongoose.Types.ObjectId;
    created_by?: mongoose.Types.ObjectId | null;
    username: string;
    stars: number;
    feedback: string;
    tags?: string[];
    createdAt: Date;
    updatedAt: Date;
}

const documentReviewSchema = new Schema<IDocumentReview>(
    {
        documentId: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: true,
            index: true,
        },
        created_by: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: false,
            default: null,
        },
        username: {
            type: String,
            required: true,
            trim: true,
            default: "Anonymous Student",
        },
        stars: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        feedback: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        tags: {
            type: [String],
            default: [],
        },
    },
    { timestamps: true }
);

documentReviewSchema.index({ documentId: 1, createdAt: -1 });

const DocumentReviewModel = mongoose.model<IDocumentReview>(
    "DocumentReview",
    documentReviewSchema,
    COLLECTION_CONSTANT.DOCUMENT_REVIEWS
);

export default DocumentReviewModel;
