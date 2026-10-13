import { model, Schema } from 'mongoose';
import { refreshTokenTime } from '@/utils/security/cookies/refreshToken';
const refreshTokenSchema = new Schema({
    userId: {
        type: Number,
        required: true
    },
    token: {
        type: String,
        required: true
    },
    isUsed: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: ()=>new Date()
    },
    expiresAt: {
        type: Date,
        default: ()=>new Date(Date.now() + refreshTokenTime * 1000)
    }
});
export default model('RefreshToken', refreshTokenSchema);
