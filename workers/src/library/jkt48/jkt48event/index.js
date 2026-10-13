import EventDetail from '@/database/showroomDB/jkt48/EventDetail';
import JKT48Event from '@/database/showroomDB/jkt48/JKT48Event';
export async function getEventList(page, perpage, options) {
    const events = await JKT48Event.find(options ?? {}).limit(perpage).skip((page - 1) * perpage).sort('-date').select('title date label id eventId memberIds').lean();
    const eventIds = events.map((i)=>i.eventId);
    const eventsData = await EventDetail.find({
        id: {
            $in: [
                ...eventIds
            ]
        }
    }).lean();
    return events.map((i)=>{
        const eventDetail = eventsData.find((s)=>s.id === i.eventId);
        return {
            id: i.id,
            title: i.title.trim(),
            poster: eventDetail?.poster,
            banner: eventDetail?.banner,
            member_count: i.memberIds?.length ?? 0,
            url: i.id?.split('-')?.[0],
            date: i.date
        };
    });
}
export async function getJKT48Event(c) {
    const maxPerpage = 30;
    let page = Number(c.req.query('page')) || 1;
    let perpage = Number(c.req.query('perpage')) || 10;
    if (perpage > maxPerpage) perpage = maxPerpage;
    const total = await JKT48Event.countDocuments({});
    const maxPage = Math.ceil(total / perpage);
    if (page < 1) page = 1;
    if (page > maxPage) page = maxPage;
    const theaterList = await getEventList(page, perpage);
    return {
        events: theaterList,
        page,
        perpage,
        total_count: total
    };
}
export async function getJKT48EventById(id) {
    return await JKT48Event.findOne({
        id
    }).lean();
}
