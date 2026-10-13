import parse from 'node-html-parser';
import scrapeRequest from '../request';
export async function getSousenkyoMemberDetail(id) {
    try {
        const url = `https://ssk.jkt48.com/2024/id/kandidat/${id}`;
        const body = await scrapeRequest(url);
        const document = parse(body);
        const scriptTags = document.querySelectorAll('script');
        const data = extractCandidateData(scriptTags.map((i)=>i.textContent));
        if (data) {
            return {
                ...data.candidate
            };
        }
        return null;
    } catch (e) {
        console.error(e);
        throw e;
    }
}
function extractCandidateData(scripts) {
    for (const script of scripts){
        const data = parseCandidateData(script);
        if (data?.candidate) {
            return data;
        }
    }
    return null;
}
function parseCandidateData(data) {
    const regex = /"9:\[\\?"\$\\?",\\?"\$L13\\?",null,(.*?)\]\\?n"/;
    const match = data.match(regex);
    if (match && match[1]) {
        const jsonString = match[1].replace(/\\"/g, '"').replace(/\\"/g, '"');
        try {
            const parsedData = JSON.parse(jsonString);
            return parsedData;
        } catch  {
            return null;
        }
    }
    return null;
}
