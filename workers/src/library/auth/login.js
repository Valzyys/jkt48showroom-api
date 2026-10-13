import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
import { parseCookieString } from '@/utils';
import { createError } from '@/utils/errorResponse';
import { createHandlers } from '@/utils/factory';
import { createToken } from '@/utils/security/token';
import { getShowroomSession } from '@/utils/showroomSession';
export function login() {
    return createHandlers(async (c)=>{
        const loginData = await c.req.parseBody();
        const body = new URLSearchParams();
        body.append('account_id', String(loginData.account_id || ''));
        body.append('password', String(loginData.password || ''));
        const sr_sess = c.get('showroom_session');
        if (sr_sess?.csrf_token) body.append('csrf_token', sr_sess?.csrf_token);
        if (loginData.captcha_word) body.append('captcha_word', String(loginData.captcha_word));
        let sr_id = sr_sess?.sr_id;
        const data = await ofetch('https://www.showroom-live.com/user/login', {
            method: 'POST',
            headers: {
                'Cookie': sr_id ? `sr_id=${sr_id}` : '',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString(),
            async onResponse ({ response }) {
                const cookies = parseCookieString(response.headers.get('Set-Cookie') || '');
                sr_id = cookies.sr_id?.value;
            }
        }).catch((e)=>e.data);
        if (data?.error) {
            return c.json(data, 401);
        }
        if (sr_id && data?.ok === 1) {
            const userData = data;
            const { accessToken, refreshToken, sessionData } = await createToken(c, String(userData.user_id), sr_id);
            return c.json({
                access_token: accessToken,
                refresh_token: refreshToken,
                user: sessionData
            });
        }
        return c.json({
            error: 'Please refresh and try again!',
            session: sr_sess
        }, 401);
    });
}
export async function logoutHandler(c, sr_id) {
    try {
        const sess = c.get('showroom_session') || (await getShowroomSession(c))?.session;
        if (!sess) throw createError({
            status: 401,
            message: 'Unauthorized!'
        });
        const body = new URLSearchParams();
        body.append('csrf_token', sess.csrf_token || '');
        await ofetch(`${env.SHOWROOM_API}/user/logout_api`, {
            headers: {
                'Cookie': `sr_id=${sr_id || sess.sr_id};`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            method: 'POST',
            body: body.toString()
        });
        return c.json({
            success: true
        });
    } catch  {
        throw createError({
            status: 401,
            message: 'Unauthorized!'
        });
    }
}
export function logout() {
    return createHandlers(async (c)=>{
        return await logoutHandler(c);
    });
}
