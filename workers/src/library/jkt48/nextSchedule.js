import {theaterScheduleDesigns} from '../../collector/theater-schedules.js';
import {env} from '../../runtime/env.js';
import dayjs from 'dayjs';
import JKT48NewSchedule from '@/database/showroomDB/jkt48/JKT48NewSchedule';
async function getSchedule() {
    const nextSchedule = await JKT48NewSchedule.find({
        date: {
            $gte: dayjs().startOf('day')
        }
    }).sort('date').limit(10).lean();
    const designs=await theaterScheduleDesigns(env,nextSchedule.filter(s=>s.type==='show').map(s=>s.code),env.REQUEST_ORIGIN||'https://api.jkt48connect.app');
    return nextSchedule.map((data)=>{
        return {
            id: String(data.schedule_id),
            date: data.start_time ?? data.date ?? new Date(0),
            code: data.code ?? undefined,
            schedule_designs: designs.get(data.code),
            category: data.type,
            title: data.title,
            url: data.link
        };
    });
}
export { getSchedule };
