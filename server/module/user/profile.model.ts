import mongoose from "mongoose";
import { COLLECTION_CONSTANT } from "../../constant/db-collection.constant.js";
const { Schema } = mongoose;

const profileSchema = new Schema({
    thumbnail: { type: String, required: true, trim: true },
    image: { type: String, required: true, trim: true },
    user_id: { type: Schema.Types.ObjectId, ref: COLLECTION_CONSTANT.USERS }
}, { timestamps: true });

const Profile = mongoose.model('Profile', profileSchema, COLLECTION_CONSTANT.PROFILE_IMAGES);

export default Profile;