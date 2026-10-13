import { Schema } from 'mongoose';
import { jkt48DB } from '@/database';
import Song from './Song';
const eventSchema = new Schema({
    id: {
        unique: true,
        required: true,
        type: String
    },
    setlist_id: String,
    title: String,
    title_alt: String,
    description: String,
    poster: String,
    banner: String,
    gallery: {
        type: [
            String
        ],
        default: []
    },
    songs: [
        {
            type: Schema.Types.ObjectId,
            ref: Song
        }
    ]
});
export default jkt48DB.model('JKT48Setlist', eventSchema);
