import {IDNGift} from '@/database/live/schema/idn/Gift';
import ShowroomGift from '@schema/showroom/ShowroomGift';
import {env} from '@/runtime/env';
import {ensureIdnGifts} from '../../idn/catalog';
import {giftImageUrl} from '../../runtime/gift-media';
import {recentGiftIds} from './gift-presentation';

export async function recentGiftCatalog(data) {
    const ids = recentGiftIds(data);
    if (data.type === 'idn') await ensureIdnGifts(env);
    const rows = data.type === 'idn'
        ? await IDNGift.find({slug: ids}).lean()
        : await ShowroomGift.find({gift_id: ids.map(Number)}).lean();
    const map = new Map(rows.map(gift => {
        const id = data.type === 'idn' ? gift.slug : gift.gift_id;
        return [String(id), {
            id,
            name: data.type === 'idn' ? gift.name : gift.gift_name,
            point: data.type === 'idn' ? gift.gold : gift.point,
            img: data.type === 'idn' && !gift.image_url ? '' : giftImageUrl(data.type, id),
            free: data.type === 'showroom' && Boolean(gift.free),
            ...(data.type === 'showroom' ? {is_delete_from_stage: gift.is_delete_from_stage} : {})
        }];
    }));
    // A missing catalog row must not hide an observed gift from the recent.
    for (const id of ids) if (!map.has(id)) map.set(id, {
        id: data.type === 'showroom' ? Number(id) : id,
        name: id,
        point: null,
        img: data.type === 'showroom' ? giftImageUrl('showroom', id) : '',
        free: false
    });
    return map;
}
