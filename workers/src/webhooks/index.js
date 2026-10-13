import { Hono } from 'hono';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { env } from '@/runtime/env';
import { Saweria } from '@/database/live/schema/Saweria';
import { createError } from '@/utils/errorResponse';
const app=new Hono();
const keys=['version','id','amount_raw','donator_name','donator_email'];
export function parsePayloadToHmacData(payload) { return keys.map(key=>payload[key]).join(''); }
app.post('/saweria',async c=>{
  if(!env.SAWERIA_KEY) throw createError({status:503,message:'Saweria is not configured'});
  const payload=await c.req.json();
  const signature=c.req.header('Saweria-Callback-Signature');
  const expected=createHmac('sha256',env.SAWERIA_KEY).update(parsePayloadToHmacData(payload)).digest('hex');
  if(!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw createError({status:401,message:'Unauthorized!'});
  if(typeof payload.id!=='string'||!payload.id) throw createError({status:400,message:'Invalid donation ID'});
  const id=createHmac('sha256',env.SAWERIA_KEY).update(payload.id).digest('hex').slice(0,24);
  await Saweria.updateOne({_id:id},{$setOnInsert:{...payload,_id:id}},{upsert:true});
  return c.text('success');
});
export default app;
