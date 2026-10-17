// Catalog entries describe gift types. Only recorded events provide counts.
export function recentGiftIds(data) {
    return [...new Set([
        ...(data.gift_data?.gift_id_list || []),
        ...(data.gift_data?.gift_log || []).flatMap(log => (log.gifts || []).map(gift => gift.gift_id))
    ].map(String))];
}

export function presentGiftEvent(gift, catalog) {
    const info = catalog.get(String(gift.gift_id));
    return {
        id: gift.gift_id,
        name: info?.name || String(gift.gift_id),
        img: info?.img || '',
        image_available: Boolean(info?.img),
        point: gift.point ?? info?.point ?? null,
        num: gift.num ?? 1,
        send_count: gift.send_count ?? null,
        date: new Date(gift.date).toISOString()
    };
}

export function giftAvailability(data, gold) {
    const observed = (data.gift_data?.gift_log || []).some(log => log.gifts?.length);
    return {
        status: observed ? 'partial' : 'unavailable',
        reason: observed ? null : gold?.reported_gold > 0 ? 'gift_events_not_captured' : 'no_gift_events_observed',
        count_source: 'observed_events',
        ...(gold ? {unattributed_gold: gold.unattributed_gold} : {})
    };
}
