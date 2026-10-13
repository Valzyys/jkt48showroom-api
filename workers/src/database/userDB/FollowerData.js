import { Schema } from 'mongoose';
import { userDB } from '..';
const followerDataSchema = new Schema({
    name: String,
    fetchId: {
        type: String,
        unique: true
    },
    idn: {
        id: String,
        follower: Number
    },
    showroom: {
        id: Number,
        level: Number,
        follower: Number
    },
    date: Date
});
followerDataSchema.index({
    'showroom.id': 1
});
export default userDB.model('FollowerData', followerDataSchema);
