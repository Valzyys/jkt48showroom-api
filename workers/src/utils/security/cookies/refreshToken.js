import { env } from '@/runtime/env';
import { ONE_MONTH } from '@/const';
const name = '_rt';
const isDev = env.NODE_ENV === 'development';
const cookieSettings = {
    secure: !isDev,
    httpOnly: true,
    sameSite: isDev ? undefined : 'None'
};
const HEADER_NAME = 'X-Refresh-Token';
export function getRefreshToken(c) {
    const refreshToken = c.req.header(HEADER_NAME);
    if (!refreshToken) {
        return null;
    }
    return refreshToken;
}
export function setRefreshToken(c, token) {
    c.header(HEADER_NAME, token);
}
export function deleteRefreshToken(c) {
    c.header(HEADER_NAME, '');
}
export const refreshTokenTime = ONE_MONTH;
