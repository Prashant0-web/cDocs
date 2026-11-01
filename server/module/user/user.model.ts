import mongoose from "mongoose";
import { COLLECTION_CONSTANT } from "../../constant/db-collection.constant.js";
const { Schema } = mongoose;


export interface IUser {
    username: string;
    email: string;
    otp?: string;
    role: 'admin' | 'user';
    uploadStrikes?: number;
    uploadBlockedUntil?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const userSchema = new Schema<IUser>({
    username: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, trim: true, unique: true },
    otp: { type: String, required: false },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    uploadStrikes: { type: Number, default: 0 },
    uploadBlockedUntil: { type: Date, default: null },
}, { timestamps: true });

// Register primary 'User' model
const User: mongoose.Model<IUser> =
    (mongoose.models.User as mongoose.Model<IUser>) ||
    mongoose.model<IUser>('User', userSchema, COLLECTION_CONSTANT.USERS);

// Also register 'users' model alias so any ref referencing 'users' or 'User' succeeds
if (!mongoose.models.users) {
    mongoose.model<IUser>('users', userSchema, COLLECTION_CONSTANT.USERS);
}

export default User;