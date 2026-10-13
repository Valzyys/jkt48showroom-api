export const showroomTokenTime = 1800;
const HEADER_NAME = 'X-SR-Token';
export function getShowroomSess(c) {
    const refreshToken = c.req.header(HEADER_NAME);
    if (!refreshToken) {
        return null;
    }
    return refreshToken;
}
export function setShowroomSess(c, token) {
    c.header(HEADER_NAME, token);
}
export function deleteShowroomSess(c) {
    c.header(HEADER_NAME, '');
}
