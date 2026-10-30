const {test}=require('node:test'),assert=require('node:assert/strict');
const {birthdayEvents,currentBirthdayJob}=require('../birthday.cjs');
const row={id:'member',name:'Member',birthdate:'2008-10-29T17:00:00.000Z'};
test('Jakarta midnight birth dates never congratulate on the previous WIB day',()=>{
 const before=birthdayEvents([row],Date.parse('2026-10-29T16:59:59Z'));
 assert.equal(before[0].options.birthdayDays,1);
 assert.equal(before[0].id,'2026-10-29:member:1');
 const actual=birthdayEvents([row],Date.parse('2026-10-29T17:00:00Z'));
 assert.equal(actual[0].options.birthdayDays,0);
 assert.equal(actual[0].id,'2026-10-30:member:0');
});
test('date-only and UTC-midnight dates, year rollover and leap-year countdown stay correct',()=>{
 const now=Date.parse('2026-10-29T09:00:00Z');
 for(const birthdate of ['2008-10-30','2008-10-30T00:00:00Z'])assert.equal(birthdayEvents([{...row,birthdate}],now)[0].options.birthdayDays,1);
 assert.equal(birthdayEvents([{...row,birthdate:'2008-12-31T17:00:00Z'}],Date.parse('2026-12-31T10:00:00Z'))[0].options.birthdayDays,1);
 assert.equal(birthdayEvents([{...row,birthdate:'2000-03-01'}],Date.parse('2024-02-29T10:00:00Z'))[0].options.birthdayDays,1);
 for(const birthdate of [null,'invalid'])assert.deepEqual(birthdayEvents([{...row,birthdate}],now),[]);
});
test('delayed birthday jobs must still match their real WIB date and reminder kind',()=>{
 const meta={birthdate:row.birthdate,member:'member',days:0},now=Date.parse('2026-10-29T10:00:00Z');
 assert.equal(currentBirthdayJob('2026-10-29:member:0',meta,now),false);
 assert.equal(currentBirthdayJob('2026-10-30:member:0',meta,now+86400000),true);
 assert.equal(currentBirthdayJob('2026-10-29:member:1',{...meta,days:1},now),true);
 assert.equal(currentBirthdayJob('2026-10-29:member:1',{...meta,days:1},now+86400000),false);
 assert.equal(currentBirthdayJob('legacy',undefined,now),false);
});
test('birthday calculation is independent of the VPS process timezone',()=>{
 const previous=process.env.TZ;
 try{
  for(const tz of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=tz;assert.equal(birthdayEvents([row],Date.parse('2026-10-29T17:00:00Z'))[0].options.birthdayDays,0)}
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
