import { model, Schema } from 'mongoose';
import { z } from 'zod';
const BannerSchema = new Schema({
    title: {
        type: String,
        required: true
    },
    img: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    }
}, {
    _id: false
});
const GroupBannerSchema = new Schema({
    group: {
        type: String,
        required: true,
        unique: true
    },
    banners: {
        type: [
            BannerSchema
        ],
        required: true
    }
}, {
    timestamps: true
});
export const BannerZod = z.object({
    title: z.string().min(1, 'Title is required'),
    img: z.string().url('Invalid image URL'),
    url: z.string().url('Invalid URL')
});
export const GroupBannerZod = z.object({
    group: z.string().min(1, 'Group name is required'),
    banners: z.array(BannerZod).min(1, 'At least one banner is required')
});
export const GroupBannersZod = z.array(GroupBannerZod).min(1, 'At least one group is required');
export const GroupBannerModel = model('GroupBanner', GroupBannerSchema);
