import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
const webhookUrl = env.DISCORD_WEBHOOK;
export async function sendLog(message) {
    await ofetch(webhookUrl, {
        method: 'POST',
        body: {
            content: message
        }
    });
}
