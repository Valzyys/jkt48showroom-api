import { Schema } from 'mongoose';
import { liveDB } from '../../';
import Showroom from '../../schema/showroom/Showroom';
const liveLogSchema = new Schema({
    is_dev: {
        type: Boolean,
        default: false
    },
    custom: {
        title: String,
        img: String,
        banner: String,
        theater: {
            title: String,
            setlist_id: String,
            price: Number,
            tax_info: String,
            date: Date,
            url: String
        }
    },
    idn: {
        id: String,
        username: String,
        slug: String,
        title: String,
        image: String,
        discountRate: Number
    },
    live_id: {
        type: Schema.Types.Mixed,
        unique: false
    },
    data_id: {
        type: String,
        required: true,
        unique: true
    },
    replay_url: String,
    live_info: {
        is_premium: {
            type: Boolean,
            default: false
        },
        live_type: Number,
        comments: {
            num: Number,
            users: Number
        },
        screenshots: {
            folder: String,
            format: String,
            list: {
                type: [
                    Number
                ],
                default: []
            }
        },
        background_image: {
            type: String
        },
        viewers: {
            active: {
                type: Number,
                default: 0
            },
            last: {
                type: Number,
                default: 0
            },
            peak: {
                type: Number,
                index: true,
                default: 0
            },
            is_excitement: Boolean
        },
        duration: {
            index: true,
            type: Number,
            default: 0
        },
        date: {
            start: {
                type: Date,
                required: true
            },
            end: {
                type: Date,
                required: true,
                index: true
            }
        }
    },
    room_id: {
        type: Number,
        index: true
    },
    gift_data: {
        free_gifts: {
            type: [
                {
                    _id: false,
                    gift_id: Number,
                    point: Number,
                    num: Number,
                    users: Number
                }
            ],
            default: []
        },
        gift_id_list: {
            type: [
                Schema.Types.Mixed
            ],
            default: []
        },
        gift_log: {
            type: [
                {
                    _id: false,
                    total: Number,
                    user_id: Schema.Types.Mixed,
                    gifts: [
                        {
                            _id: false,
                            gift_id: Schema.Types.Mixed,
                            num: {
                                type: Number,
                                default: 1
                            },
                            send_count: Number,
                            gold: Number,
                            point: Number,
                            date: Date
                        }
                    ]
                }
            ],
            default: []
        }
    },
    total_gifts: {
        type: Number,
        default: 0
    },
    c_gift: {
        type: Number,
        default: 0,
        index: true
    },
    record_dates: [
        {
            _id: false,
            from: {
                type: Date,
                default: ()=>Date.now()
            },
            to: {
                type: Date,
                default: ()=>Date.now()
            }
        }
    ],
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
        ]
    },
    gift_rate: Number,
    created_at: {
        type: Date,
        required: true
    },
    type: String
});
liveLogSchema.virtual('room_info', {
    ref: Showroom,
    localField: 'room_id',
    foreignField: 'room_id',
    justOne: true
});
liveLogSchema.index({
    data_id: 1,
    room_id: 1
});
liveLogSchema.index({
    'users.user_id': 1,
    'room_id': 1
});
liveLogSchema.index({
    'is_dev': 1,
    'live_info.date.end': -1,
    'data_id': 1
});
liveLogSchema.index({
    live_id: 1
});
export default liveDB.model('LiveLog', liveLogSchema);
