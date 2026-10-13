import { model, Schema } from 'mongoose';
export default model('Config', new Schema({
    configname: {
        type: String,
        required: true,
        unique: true
    },
    value: {
        type: Schema.Types.Mixed,
        required: true
    }
}));
