import { env } from '@/runtime/env';
import { deleteCookie, getCookie } from 'hono/cookie';
const name = '_sid';
const isDev = env.NODE_ENV === 'development';
const cookieSettings = {
    secure: !isDev,
    sameSite: isDev ? undefined : 'None'
};
export function getSessId(c) {
    return c.get('sid') || getCookie(c, name);
}
export function setSessId(c, token) {}
export function deleteSessId(c) {
    deleteCookie(c, name, {
        ...cookieSettings
    });
}
