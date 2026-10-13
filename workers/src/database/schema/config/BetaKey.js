import { Schema } from 'mongoose';
import { liveDB } from '@/database';
const BetaKeySchema = new Schema({
    keyHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    },
    maxDevices: {
        type: Number,
        min: 1
    },
    enrollmentVersion: {
        type: Number,
        required: true,
        default: 0
    },
    lastUsedAt: {
        type: Date
    },
    note: {
        type: String,
        trim: true,
        maxlength: 200
    }
}, {
    timestamps: true
});
export const BetaKeyModel = liveDB.model('BetaKey', BetaKeySchema, 'betakeys');
