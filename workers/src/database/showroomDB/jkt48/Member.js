import { Schema } from 'mongoose';
import { jkt48DB } from '@/database';
const memberSchema = new Schema({
    id: {
        required: true,
        unique: true,
        type: String
    },
    old_id: String,
    name: {
        type: String,
        default: ''
    },
    url: {
        type: String,
        default: ''
    }
});
export default jkt48DB.model('JKT48Member', memberSchema);
