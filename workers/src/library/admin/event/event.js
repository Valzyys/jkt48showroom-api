import EventDetail from '@/database/showroomDB/jkt48/EventDetail';
export default async function getAllEvent() {
    try {
        const setlists = await EventDetail.find({}).lean().lean();
        return setlists;
    } catch (e) {
        console.error(e);
        return [];
    }
}
