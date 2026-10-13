const cookieOpts = [
    'Path',
    'Expires',
    'Max-Age',
    'Secure',
    'HttpOnly',
    'SameSite',
    'Domain'
];
class CookieParser extends Map {
    constructor(cookieString){
        super();
        if (cookieString) {
            this.addCookies(cookieString);
        }
    }
    addCookies(cookieString) {
        const cookies = this.parseCookie(cookieString);
        for (const [key, value] of cookies.entries()){
            this.set(key, value);
        }
        return this;
    }
    toArray() {
        return [
            ...this.values()
        ];
    }
    toString() {
        return this.serializeCookie(this.toArray());
    }
    parseCookie(cookieString) {
        const splitted = cookieString.split(';');
        const cookieMap = new Map();
        const cookieArray = [];
        let num = -1;
        for (const s of splitted){
            if (s) {
                const c = s?.trim().split('=');
                if (!cookieOpts.some((i)=>i.toLowerCase() === c[0]?.trim()?.toLowerCase())) {
                    num++;
                    cookieArray.push({
                        name: c[0],
                        value: c[1],
                        options: []
                    });
                } else {
                    cookieArray[num].options.push({
                        name: c[0],
                        value: c.slice(1, c.length)?.join('=') || undefined
                    });
                }
            }
        }
        for (const a of cookieArray){
            cookieMap.set(a.name, a);
        }
        return cookieMap;
    }
    serializeCookie(cookies) {
        const c = [];
        for (const cookie of cookies){
            c.push(`${cookie.name}=${cookie.value}`);
            for (const opt of cookie.options){
                if (opt.value) {
                    c.push(`${opt.name}=${opt.value}`);
                } else {
                    c.push(opt.name);
                }
            }
        }
        return c.join('; ');
    }
}
export default CookieParser;
