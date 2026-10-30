const {DatabaseSync}=require('node:sqlite');
const COOLDOWN=60000,DAILY_CAP=100;
const threshold=level=>50*level*(level+1);
function levelFor(xp){return Math.min(100,Math.floor((Math.sqrt(1+4*Math.max(0,xp)/50)-1)/2))}
function dayWib(time){return new Date(time+7*3600000).toISOString().slice(0,10)}
class LevelStore{
 constructor(file){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS levels(guild_id TEXT,user_id TEXT,xp INTEGER NOT NULL DEFAULT 0,messages INTEGER NOT NULL DEFAULT 0,last_award INTEGER NOT NULL DEFAULT 0,last_message TEXT NOT NULL DEFAULT '0',day TEXT NOT NULL DEFAULT '',daily INTEGER NOT NULL DEFAULT 0,reward INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
 CREATE INDEX IF NOT EXISTS levels_ranking ON levels(guild_id,xp DESC,user_id);`);
 this.find=this.db.prepare('SELECT * FROM levels WHERE guild_id=? AND user_id=?');
 this.write=this.db.prepare(`INSERT INTO levels(guild_id,user_id,xp,messages,last_award,last_message,day,daily)VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=excluded.xp,messages=excluded.messages,last_award=excluded.last_award,last_message=excluded.last_message,day=excluded.day,daily=excluded.daily`);
 }
 get(guild,user){return this.find.get(guild,user)||{guild_id:guild,user_id:user,xp:0,messages:0,last_award:0,last_message:'0',day:'',daily:0,reward:0}}
 award({guild,user,message,timestamp,now=Date.now(),amount}){
  if(!/^\d{15,22}$/.test(message)||!Number.isSafeInteger(timestamp)||timestamp>now+30000||timestamp<now-120000||!Number.isInteger(amount)||amount<15||amount>25)return{awarded:false,reason:'invalid'};
  this.db.exec('BEGIN IMMEDIATE');try{const old=this.get(guild,user),day=dayWib(timestamp),daily=old.day===day?old.daily:0;
   if(BigInt(message)<=BigInt(old.last_message)||timestamp-old.last_award<COOLDOWN||daily>=DAILY_CAP){this.db.exec('COMMIT');return{awarded:false,reason:daily>=DAILY_CAP?'daily_cap':'cooldown_or_duplicate'}}
   const xp=old.xp+amount;this.write.run(guild,user,xp,old.messages+1,timestamp,message,day,daily+1);this.db.exec('COMMIT');return{awarded:true,amount,previousLevel:levelFor(old.xp),level:levelFor(xp),row:this.get(guild,user)};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 rank(guild,user){const row=this.get(guild,user);return row.messages?Number(this.db.prepare('SELECT count(*) n FROM levels WHERE guild_id=? AND (xp>? OR (xp=? AND user_id<?))').get(guild,row.xp,row.xp,user).n)+1:null}
 leaders(guild,page=1){return this.db.prepare('SELECT user_id,xp,messages FROM levels WHERE guild_id=? ORDER BY xp DESC,user_id LIMIT 10 OFFSET ?').all(guild,(page-1)*10)}
 count(guild){return Number(this.db.prepare('SELECT count(*) n FROM levels WHERE guild_id=?').get(guild).n)}
 rewarded(guild,user,level){this.db.prepare('UPDATE levels SET reward=? WHERE guild_id=? AND user_id=?').run(level,guild,user)}
 close(){this.db.close()}
}
module.exports={LevelStore,COOLDOWN,DAILY_CAP,threshold,levelFor,dayWib};
