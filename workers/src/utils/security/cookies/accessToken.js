export const accessTokenTime = 3600 * 24;
const HEADER_NAME = 'X-Access-Token';
export function getAccessToken(c) {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.replace('Bearer ', '');
}
export function setAccessToken(c, token) {
    c.header(HEADER_NAME, token);
}
export function deleteAccessToken(c) {
    c.header(HEADER_NAME, '');
}
