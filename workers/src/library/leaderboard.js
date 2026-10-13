import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
export async function getLeaderboard() {
    return await ofetch('https://backend.saweria.co/widgets/leaderboard/all', {
        headers: {
            'Stream-Key': env.SAWERIA_KEY ?? ''
        }
    });
}
