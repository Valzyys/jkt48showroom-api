import { Hono } from 'hono';
import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
import cache from '@/utils/cache';
import { useCORS } from '@/utils/cors';
import { checkToken } from '@/utils/security/token';
import { useShowroomSession } from '@/utils/showroomSession';
const app=new Hono();
app.use('*',useCORS('self'));
app.use('*',checkToken(false));
app.use('*',useShowroomSession());
const routes={
  '/user/profile':'/api/user/profile','/status':'/api/room/status','/onlives':'/api/live/onlives',
  '/polling':'/api/live/polling','/summary_ranking':'/api/live/summary_ranking','/stage_user_list':'/api/live/stage_user_list',
  '/live_info':'/api/live/live_info','/telop':'/api/live/telop','/greeting':'/api/room/greeting',
  '/streaming_url':'/api/live/streaming_url','/current_user':'/api/live/current_user','/csrf_token':'/api/csrf_token','/follow':'/api/follow/rooms'
};
for(const [path,target] of Object.entries(routes)) app.get(path,async c=>{
  const session=c.get('showroom_session'),user=c.get('user');
  const srId=user?.sr_id||session?.sr_id;
  c.header('Cache-Control','no-store');
  return c.json(await ofetch('https://www.showroom-live.com'+target,{
    query:c.req.query(),headers:{Cookie:srId?`sr_id=${srId}`:'',Referer:'https://www.showroom-live.com/'},retry:0
  }));
});
export default app;
