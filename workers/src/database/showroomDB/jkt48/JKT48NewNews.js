import { Schema } from 'mongoose';
import { jkt48DB } from '../..';
const newsSchema = new Schema({
    news_id: {
        type: Number,
        unique: true,
        required: true
    },
    title: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        default: ''
    },
    link: {
        type: String,
        default: ''
    },
    background_image: {
        type: String,
        default: null
    },
    is_published: {
        type: Boolean,
        default: false
    },
    sort_order: {
        type: Number,
        default: null
    },
    valid_date_from: {
        type: String,
        default: ''
    },
    valid_date_to: {
        type: String,
        default: null
    },
    status: {
        type: Boolean,
        default: false
    },
    short_description: {
        type: String,
        default: null
    },
    content_body: {
        type: String,
        default: null
    },
    external_url: {
        type: String,
        default: null
    }
});
export default jkt48DB.model('JKT48NewNews', newsSchema);
