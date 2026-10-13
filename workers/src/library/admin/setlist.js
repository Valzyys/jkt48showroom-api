import Setlist from '@/database/showroomDB/jkt48/Setlist';
export default async function getAllSetlist() {
    try {
        const setlists = await Setlist.find({}).populate('songs').lean().lean();
        return setlists;
    } catch (e) {
        console.error(e);
        return [];
    }
}
