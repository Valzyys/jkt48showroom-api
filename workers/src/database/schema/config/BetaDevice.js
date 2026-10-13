import { Schema } from 'mongoose';
import { liveDB } from '@/database';
const BetaDeviceSchema = new Schema({
    fingerprint: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    enabled: {
        type: Boolean,
        required: true,
        default: true
    },
    bypassKey: {
        type: Schema.Types.ObjectId,
        ref: 'BetaKey',
        index: true
    },
    note: {
        type: String,
        trim: true,
        maxlength: 200
    },
    lastSeenAt: {
        type: Date
    }
}, {
    timestamps: true
});
export const BetaDeviceModel = liveDB.model('BetaDevice', BetaDeviceSchema, 'allowedbetadevices');
