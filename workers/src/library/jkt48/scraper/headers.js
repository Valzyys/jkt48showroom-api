import Config from '@/database/schema/config/Config';
export async function getJKT48Headers() {
  const cookies=await Config.findOne({configname:'cookies_jkt48'});
  const userAgent=await Config.findOne({configname:'useragent_jkt48'});
  return {'Cookie':cookies?.value||'','User-Agent':userAgent?.value||'JKT48ShowroomAPI/0.14.2'};
}
