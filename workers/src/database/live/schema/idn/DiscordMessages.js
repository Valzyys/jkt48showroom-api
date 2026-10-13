import { Schema } from 'mongoose';
import { liveDB } from '../../../';
const IDNDiscordMessages = new Schema({
    data_id: {
        type: String,
        required: true
    },
    message_id: {
        type: String,
        required: true
    },
    channel_id: {
        type: String,
        required: true
    },
    bot_id: {
        type: String,
        required: true
    }
});
export default liveDB.model('IDN_Discord_Message', IDNDiscordMessages);
