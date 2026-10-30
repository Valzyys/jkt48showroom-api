const WIB=7*3600000,DAY=86400000;
function wibDay(time=Date.now()){return new Date(time+WIB).toISOString().slice(0,10)}
function birthdayEvents(rows,time=Date.now()){
 const today=new Date(time+WIB),day=wibDay(time),midnight=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
 return rows.flatMap(row=>{
  if(!row.birthdate)return[];
  const stamp=Date.parse(row.birthdate);if(!Number.isFinite(stamp))return[];
  // Stored timestamps represent Jakarta dates, often 17:00Z the previous day.
  const born=new Date(stamp+WIB);let next=Date.UTC(today.getUTCFullYear(),born.getUTCMonth(),born.getUTCDate());
  if(next<midnight)next=Date.UTC(today.getUTCFullYear()+1,born.getUTCMonth(),born.getUTCDate());
  const days=Math.round((next-midnight)/DAY);
  return [0,1,7].includes(days)?[{id:`${day}:${row.id||row.name}:${days}`,row,options:{birthdayDays:days}}]:[];
 });
}
function currentBirthdayJob(event,metadata,time=Date.now()){
 if(!metadata||typeof metadata.birthdate!=='string'||!metadata.member)return false;
 return birthdayEvents([{birthdate:metadata.birthdate,id:metadata.member}],time).some(item=>item.id===event&&item.options.birthdayDays===metadata.days);
}
module.exports={wibDay,birthdayEvents,currentBirthdayJob};
