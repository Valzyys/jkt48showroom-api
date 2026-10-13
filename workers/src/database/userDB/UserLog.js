import { Schema } from 'mongoose';
import { userDB } from '..';
const userLogSchema = new Schema({
    data_id: {
        type: String,
        required: true
    },
    users: {
        type: [
            {
                _id: false,
                user_id: Schema.Types.Mixed,
                name: String,
                comments: Number,
                avatar_id: Number,
                avatar_url: String
            }
        ],
        default: []
    },
    created_at: Date
});
userLogSchema.index({
    'users.user_id': 1
});
export default userDB.model('UserLog', userLogSchema);
