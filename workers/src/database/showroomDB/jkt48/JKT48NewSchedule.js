import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Schema } from 'mongoose';
import { jkt48DB } from '../..';
import { jakartaTime } from '@/runtime/jkt48-source';
dayjs.extend(utc);
dayjs.extend(timezone);
function normalizeScheduleType(type) {
    if (typeof type !== 'string') {
        return 'schedule';
    }
    return type.trim().toLowerCase();
}
export function isEventSchedule(schedule) {
    return normalizeScheduleType(schedule.type) === 'event';
}
export function isTheaterSchedule(schedule) {
    return normalizeScheduleType(schedule.type) === 'show';
}
export function isRegularSchedule(schedule) {
    return normalizeScheduleType(schedule.type) === 'schedule';
}
function toDate(value) {
    if (!value) {
        return undefined;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
function toDateOrUndefined(value) {
    const date = toDate(value);
    return date ?? undefined;
}
function toStringOrUndefined(value) {
    return typeof value === 'string' ? value : undefined;
}
function toStringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}
function toNumberOrUndefined(value) {
    return typeof value === 'number' ? value : undefined;
}
function toNumberOrZero(value) {
    return typeof value === 'number' ? value : 0;
}
function toBooleanOrUndefined(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function mapMember(member) {
    if (!member || typeof member !== 'object') {
        return null;
    }
    const item = member;
    if (typeof item.member_id !== 'number') {
        return null;
    }
    return {
        member_id: item.member_id,
        name: typeof item.name === 'string' ? item.name : '',
        type: typeof item.type === 'string' ? item.type : ''
    };
}
function mapSalesPeriod(period) {
    if (!period || typeof period !== 'object') {
        return null;
    }
    const item = period;
    if (typeof item.label !== 'string') {
        return null;
    }
    const pricing = Array.isArray(item.pricing) ? item.pricing.filter((price)=>Boolean(price && typeof price === 'object')).map((price)=>({
            label: typeof price.label === 'string' ? price.label : '',
            price: typeof price.price === 'number' ? price.price : 0,
            quota: typeof price.quota === 'number' ? price.quota : 0,
            is_ofc_only: typeof price.is_ofc_only === 'boolean' ? price.is_ofc_only : false
        })) : [];
    return {
        label: item.label,
        start_date: typeof item.start_date === 'string' ? item.start_date : '',
        end_date: typeof item.end_date === 'string' ? item.end_date : '',
        sales_method: typeof item.sales_method === 'string' ? item.sales_method : '',
        pricing
    };
}
export function replaceTime(isoString, timeString) {
    return new Date(jakartaTime(isoString,timeString));
}
export function mapJKT48ScheduleFromApi(raw) {
    const members = Array.isArray(raw.jkt48_member) ? raw.jkt48_member.map(mapMember).filter((member)=>member !== null) : [];
    const salesPeriod = Array.isArray(raw.sales_period) ? raw.sales_period.map(mapSalesPeriod).filter((period)=>period !== null) : [];
    const type = normalizeScheduleType(raw.type);
    const birthday_member = [];
    for (const member_name of raw.birthday_member_name ?? []){
        const m = raw.jkt48_member?.find((i)=>i.name === member_name);
        if (m) birthday_member.push(m);
    }
    const mapped = {
        schedule_id: raw.schedule_id,
        code: toStringOrEmpty(raw.code),
        link: toStringOrEmpty(raw.link),
        default_price: toNumberOrZero(raw.default_price),
        total_quota: toNumberOrZero(raw.total_quota),
        max_purchase: toNumberOrZero(raw.max_purchase),
        valid_date_from: toDateOrUndefined(raw.valid_date_from),
        valid_date_to: toDateOrUndefined(raw.valid_date_to),
        created_date: toDateOrUndefined(raw.created_date),
        modified_date: toDateOrUndefined(raw.modified_date),
        created_by: toNumberOrZero(raw.created_by),
        modified_by: toNumberOrUndefined(raw.modified_by),
        date: toDate(raw.date),
        start_time: raw.date && raw.start_time ? replaceTime(raw.date, raw.start_time) : undefined,
        end_time: raw.date && raw.end_time ? replaceTime(raw.date, raw.end_time) : undefined,
        reception_start_time: toStringOrEmpty(raw.reception_start_time),
        reception_end_time: toStringOrEmpty(raw.reception_end_time),
        seating_layout: toStringOrEmpty(raw.seating_layout),
        jkt48_member_type: toStringOrUndefined(raw.jkt48_member_type),
        background_image: toStringOrUndefined(raw.background_image),
        title: toStringOrEmpty(raw.title),
        short_description: toStringOrUndefined(raw.short_description),
        content_body: toStringOrUndefined(raw.content_body),
        jkt48_member: members,
        sales_period: salesPeriod,
        type,
        event_id: typeof raw.event_id === 'number' ? raw.event_id : undefined,
        is_in_theater: toBooleanOrUndefined(raw.is_in_theater),
        is_external_ticketing: toBooleanOrUndefined(raw.is_external_ticketing),
        external_ticketing_url: typeof raw.external_ticketing_url === 'string' ? raw.external_ticketing_url : undefined,
        theater_show_id: typeof raw.theater_show_id === 'number' ? raw.theater_show_id : undefined,
        set_list: raw.set_list && typeof raw.set_list === 'string' ? raw.set_list : undefined,
        birthday_member: birthday_member || undefined
    };
    return Object.fromEntries(Object.entries(mapped).filter(([_, v])=>v !== undefined));
}
const scheduleSchema = new Schema({
    schedule_id: {
        type: Number,
        unique: true
    },
    link: {
        type: String,
        default: ''
    },
    event_id: {
        type: Number,
        unique: true,
        sparse: true
    },
    theater_show_id: {
        type: Number,
        unique: true,
        sparse: true
    },
    code: {
        type: String
    },
    default_price: {
        type: Number,
        default: 0
    },
    total_quota: {
        type: Number,
        default: 0
    },
    max_purchase: {
        type: Number,
        default: 0
    },
    valid_date_from: {
        type: Date
    },
    valid_date_to: {
        type: Date
    },
    created_date: {
        type: Date
    },
    modified_date: {
        type: Date
    },
    created_by: {
        type: Number,
        default: 0
    },
    modified_by: {
        type: Number
    },
    date: {
        type: Date
    },
    type: {
        type: String,
        default: 'schedule'
    },
    start_time: {
        type: Date
    },
    end_time: {
        type: String,
        default: ''
    },
    reception_start_time: {
        type: String,
        default: ''
    },
    reception_end_time: {
        type: String,
        default: ''
    },
    seating_layout: {
        type: String,
        default: ''
    },
    jkt48_member_type: {
        type: String
    },
    background_image: {
        type: String
    },
    title: {
        type: String,
        default: ''
    },
    short_description: {
        type: String
    },
    content_body: {
        type: String
    },
    jkt48_member: {
        type: [
            {
                name: {
                    type: String,
                    default: ''
                },
                type: {
                    type: String,
                    default: ''
                },
                member_id: {
                    type: Number,
                    required: true
                }
            }
        ],
        default: []
    },
    sales_period: {
        type: [
            {
                label: {
                    type: String,
                    default: ''
                },
                start_date: {
                    type: String,
                    default: ''
                },
                end_date: {
                    type: String,
                    default: ''
                },
                sales_method: {
                    type: String,
                    default: ''
                },
                pricing: {
                    type: [
                        {
                            label: {
                                type: String,
                                default: ''
                            },
                            price: {
                                type: Number,
                                default: 0
                            },
                            quota: {
                                type: Number,
                                default: 0
                            },
                            is_ofc_only: {
                                type: Boolean,
                                default: false
                            }
                        }
                    ],
                    default: []
                }
            }
        ],
        default: []
    },
    is_in_theater: {
        type: Boolean
    },
    is_external_ticketing: {
        type: Boolean
    },
    external_ticketing_url: {
        type: String
    },
    set_list: {
        type: String
    },
    graduation_member: [
        {
            name: {
                type: String,
                default: ''
            },
            type: {
                type: String,
                default: ''
            },
            member_id: {
                type: Number,
                required: true
            }
        }
    ],
    birthday_member: [
        {
            name: {
                type: String,
                default: ''
            },
            type: {
                type: String,
                default: ''
            },
            member_id: {
                type: Number,
                required: true
            }
        }
    ],
    showroom: {
        entrance_url: String,
        room_url: String,
        image: String,
        premium_live_type: Number,
        is_onlive: Boolean,
        title: String,
        paid_live_id: Number,
        room_id: Number,
        room_name: String,
        start_at: Number,
        price: Number
    },
    idn_live: {
        title: String,
        slug: String,
        image: String,
        start_at: Number,
        username: String,
        uuid: String,
        price: Number,
        room_identifier: String
    }
});
scheduleSchema.statics.findByType = async function findByType(type) {
    const normalizedType = normalizeScheduleType(type);
    const docs = await this.find({
        type: normalizedType
    }).lean();
    if (normalizedType === 'event') {
        return docs.filter(isEventSchedule);
    }
    if (normalizedType === 'show') {
        return docs.filter(isTheaterSchedule);
    }
    if (normalizedType === 'schedule') {
        return docs.filter(isRegularSchedule);
    }
    return docs;
};
export default jkt48DB.model('JKT48NewSchedule', scheduleSchema);
