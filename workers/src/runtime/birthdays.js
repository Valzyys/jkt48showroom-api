export function jakartaDateParts(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + 7 * 3600000);
  return {year:local.getUTCFullYear(),month:local.getUTCMonth()+1,day:local.getUTCDate()};
}
export function upcomingBirthdays(members, now = new Date(), limit = 6) {
  const today = jakartaDateParts(now);
  const dayKey = ({month,day}) => month * 32 + day;
  return members.map(member => ({member,date:jakartaDateParts(member.info?.birthdate)}))
    .filter(row => row.date)
    .sort((a,b) => ((dayKey(a.date)-dayKey(today)+384)%384)-((dayKey(b.date)-dayKey(today)+384)%384) || a.member.name.localeCompare(b.member.name))
    .slice(0,limit).map(row => row.member);
}
