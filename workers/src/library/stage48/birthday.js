import IdolMember from '@/database/schema/48group/IdolMember';
import Member from '@/database/schema/48group/Member';
import Showroom from '@/database/schema/showroom/Showroom';
import { jakartaDateParts, upcomingBirthdays } from '@/runtime/birthdays';

export async function getMemberBirthdays(c) {
    const group = c.req.query('group') || 'jkt48';
    const today = jakartaDateParts(new Date());
    const profiles = await Member.find({isGraduate:false,group}).lean();
    const members = profiles.filter(member => jakartaDateParts(member.birthdate)?.month === today.month)
        .sort((a,b) => jakartaDateParts(a.birthdate).day-jakartaDateParts(b.birthdate).day);
    return Promise.all(members.map(async member => {
        const showroom = member.showroom_id ? await Showroom.findOne({room_id:member.showroom_id}).lean() : null;
        return {name:member.nicknames?.[0] || member.name,birthdate:member.birthdate,img:member.img,
            room_id:member.showroom_id,url_key:showroom?.url};
    }));
}
export async function nextBirthDay(c) {
    const group = c.req.query('group') || 'jkt48';
    const members = await IdolMember.find({'info.is_graduate':false,group}).lean();
    return upcomingBirthdays(members).map(member => ({
        name:member.info?.nicknames?.[0] || member.name,birthdate:member.info.birthdate,
        img:member.info?.img,room_id:member.showroom_id,url_key:member.slug
    }));
}
