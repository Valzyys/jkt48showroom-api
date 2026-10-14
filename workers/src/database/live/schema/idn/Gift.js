import { Schema } from 'mongoose';
import { liveDB } from '../../../';
const idnGiftSchema = new Schema({
    name: String,
    slug: String,
    gold: Number,
    point: Number,
    image_url: String,
    animation_small: String,
    animation_large: String,
    bg_color: String,
    exp: {
        type: Number,
        default: 0
    },
    theme: {
        name: String,
        slug: String
    }
});
idnGiftSchema.index({
    slug: 1
}, {
    unique: true
});
export const IDNGift = liveDB.model('IDN_Gift', idnGiftSchema);
