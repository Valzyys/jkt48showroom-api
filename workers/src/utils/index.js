export function getDateRange(_type) {
    const date = new Date();
    date.setHours(0, 0, 0, -1);
    const from = new Date(new Date(date).setDate(date.getDate() - 7));
    const to = new Date(date);
    from.setHours(0, 0, 0, 0);
    return {
        from: from.toISOString(),
        to: to.toISOString()
    };
}
export function parseCookieString(cookieString) {
    const cookieObj = {};
    if (cookieString) {
        const cookies = cookieString.split(',');
        cookies.forEach((cookie)=>{
            const parts = cookie.trim().split(';');
            const [name, value] = parts[0].trim().split('=');
            const attributes = {};
            parts.slice(1).forEach((attr)=>{
                const [attrName, attrValue] = attr.trim().split('=');
                attributes[attrName.toLowerCase()] = attrValue;
            });
            cookieObj[name] = {
                value: decodeURIComponent(value),
                attributes
            };
        });
    }
    return cookieObj;
}
export function sleep(ms) {
    return new Promise((resolve)=>{
        setTimeout(resolve, ms);
    });
}
export async function streamToString(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while(true){
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, {
            stream: true
        });
    }
    result += decoder.decode();
    return result;
}
export function convertToMilliseconds(timestamp) {
    return timestamp * (timestamp < 1e10 ? 1e3 : 1);
}
