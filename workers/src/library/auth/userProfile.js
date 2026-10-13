import { ofetch } from '@/runtime/http';
export async function getUserProfile(user_id, sr_id) {
    return await ofetch('https://www.showroom-live.com/api/user/profile', {
        params: {
            user_id
        },
        headers: {
            Cookie: sr_id ? `sr_id=${sr_id}` : ''
        }
    });
}
