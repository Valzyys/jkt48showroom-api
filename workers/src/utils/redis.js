import { env } from '@/runtime/env';
import Redis from 'ioredis';
const client = new Redis(env.REDIS_URI ?? '');
client.on('error', (err)=>console.log('Redis Client Error', err));
client.on('connect', ()=>console.log('Connected to Redis'));
export default client;
