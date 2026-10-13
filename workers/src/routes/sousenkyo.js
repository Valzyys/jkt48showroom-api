import { Hono } from 'hono';
import { useCORS } from '@/utils/cors';
const app = new Hono();
app.use('*', useCORS('self'));
export default app;
