import { Schema } from 'mongoose';
import { jkt48DB } from '@/database';
const sousenkyo = new Schema({
    id: String,
    data: {
        name: String,
        id: String,
        url: String,
        data: {
            id: Number,
            name: String,
            img: String,
            dob: String,
            nickname: String,
            url_video: String,
            tagline: String,
            bg: String,
            mobileBg: String,
            tag: String,
            mTag: String,
            nameImg: String,
            count: {
                type: Number,
                default: 0
            },
            darkTheme: Boolean,
            ja: {
                name: String,
                dob: String,
                nickname: String,
                tagline: String
            }
        }
    },
    last_fetch: {
        type: Date
    }
});
export default jkt48DB.model('Sousenkyo2024', sousenkyo);
