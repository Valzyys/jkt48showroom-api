import { env } from '@/runtime/env';
import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'jsonwebtoken';
import { ofetch } from '@/runtime/http';
import { parseCookieString } from '.';
import { createError } from './errorResponse';
import { getShowroomSess, setShowroomSess, showroomTokenTime } from './security/cookies/showroomSess';
import { getDecodedToken } from './security/token';
function verifyShowroomSessionToken(token) {
    if (!token) {
        return null;
    }
    try {
        const decoded = verify(token, env.SECRET, {algorithms:['HS256']});
        if (!decoded || typeof decoded === 'string' || !decoded.exp) {
            return null;
        }
        return decoded;
    } catch  {
        return null;
    }
}
export async function createShowroomSession(c) {
    const user = c.get('user') || getDecodedToken(c);
    let sr_id = user?.sr_id;
    const res = await ofetch(`${env.SHOWROOM_API}/api/csrf_token`, {
        headers: {
            Cookie: sr_id ? `sr_id=${sr_id};` : ''
        },
        onResponse ({ response }) {
            if (!sr_id) {
                const cookies = parseCookieString(response.headers.get('Set-Cookie') || '');
                if (cookies.sr_id?.value) {
                    sr_id = cookies.sr_id?.value;
                }
            }
        }
    });
    const csrf_token = res.csrf_token;
    return {
        sr_id,
        csrf_token
    };
}
export async function getShowroomSession(c) {
    let sess = verifyShowroomSessionToken(getShowroomSess(c));
    let setCookie = false;
    const user = c.get('user');
    const sr_id = sess?.sr_id || c.get('showroom_session')?.sr_id;
    if (user?.sr_id && user.sr_id !== sr_id || sr_id == null) {
        sess = await createShowroomSession(c).catch(()=>null);
        setCookie = true;
    }
    if (!sess?.sr_id || !sess?.csrf_token) {
        throw createError({
            status: 503,
            message: 'Failed to initialize showroom session'
        });
    }
    return {
        session: sess,
        setCookie
    };
}
export function useShowroomSession() {
    return createMiddleware(async (c, next)=>{
        const sess = await getShowroomSession(c);
        if (sess.setCookie) {
            const currentTime = Math.floor(Date.now() / 1000);
            const sessToken = sign({
                ...sess.session,
                exp: currentTime + showroomTokenTime
            }, env.SECRET);
            setShowroomSess(c, sessToken);
        }
        c.set('showroom_session', sess.session);
        await next();
    });
}
