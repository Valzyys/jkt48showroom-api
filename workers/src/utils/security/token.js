import { env } from '@/runtime/env';
import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { ofetch } from '@/runtime/http';
import { logoutHandler as logout } from '@/library/auth/login';
import { isAdmin } from '.';
import { parseCookieString } from '..';
import { createError } from '../errorResponse';
import { accessTokenTime, deleteAccessToken, getAccessToken, setAccessToken } from './cookies/accessToken';
import { deleteRefreshToken, getRefreshToken, refreshTokenTime, setRefreshToken } from './cookies/refreshToken';
function decodeToken(token) {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === 'string') {
        return null;
    }
    return decoded;
}
function verifyToken(token, secret) {
    const decoded = jwt.verify(token, secret, {algorithms:['HS256']});
    if (!decoded || typeof decoded === 'string') {
        throw new Error('Invalid token payload');
    }
    return decoded;
}
export function getDecodedToken(c) {
    const token = getAccessToken(c);
    if (token) {
        try { return verifyToken(token, env.AUTH_SECRET); } catch { return null; }
    }
    return null;
}
export const tokenCaches = new Map();
export function checkToken(mustAuth = true) {
    return createMiddleware(async (c, next)=>{
        const token = getAccessToken(c);
        const refreshToken = getRefreshToken(c);
        let decodedToken;
        let err = '';
        if (token || refreshToken) {
            decodedToken = token ? (()=>{
                try {
                    return verifyToken(token, env.AUTH_SECRET);
                } catch (e) {
                    console.error(e);
                    err = String(e);
                    return null;
                }
            })() : null;
            if (!decodedToken && refreshToken) {
                decodedToken = await getRefreshedToken(c, refreshToken).catch(()=>null);
            }
            if (decodedToken) {
                c.set('user', decodedToken);
                return await next();
            }
            clearToken(c);
        }
        if (mustAuth) {
            throw createError({
                status: 401,
                message: 'Unauthorized!'
            });
        }
        return await next();
    });
}
export async function getRefreshedToken(c, refreshToken) {
    const decodedRefreshToken = (()=>{
        try {
            return verifyToken(refreshToken, env.AUTH_SECRET);
        } catch  {
            return null;
        }
    })();
    if (decodedRefreshToken && decodedRefreshToken?.id && decodedRefreshToken.sr_id) {
        const { sessionData } = await createToken(c, decodedRefreshToken.id, decodedRefreshToken.sr_id);
        return sessionData;
    }
    throw new Error('Failed to refresh token!');
}
export async function createToken(c, user_id, sr_id) {
    const userProfile = await ofetch('https://www.showroom-live.com/api/user/profile', {
        params: {
            user_id
        },
        headers: {
            Cookie: sr_id ? `sr_id=${sr_id}` : ''
        },
        async onResponse ({ response }) {
            const cookies = parseCookieString(response.headers.get('Set-Cookie') || '');
            if (cookies.sr_id?.value) {
                sr_id = cookies.sr_id.value;
            }
        }
    });
    const currentTime = Math.floor(Date.now() / 1000);
    const sessionData = {
        id: user_id,
        name: userProfile.name,
        account_id: userProfile.account_id,
        image: userProfile.image,
        avatar_id: String(userProfile.avatar_id),
        is_admin: isAdmin(user_id),
        sr_id,
        exp: currentTime + accessTokenTime
    };
    if (!sessionData.account_id) throw createError({
        status: 401,
        message: 'Unauthorized!'
    });
    const accessToken = jwt.sign(sessionData, env.AUTH_SECRET);
    const refreshToken = jwt.sign({
        id: user_id,
        sr_id,
        exp: currentTime + refreshTokenTime
    }, env.AUTH_SECRET);
    setAccessToken(c, accessToken);
    setRefreshToken(c, refreshToken);
    return {
        accessToken,
        refreshToken,
        sessionData
    };
}
export function clearToken(c) {
    deleteAccessToken(c);
    deleteRefreshToken(c);
}
