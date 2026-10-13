export function getTheaterId(url) {
    const match = url.match(/\/(\d+)\?/);
    return match ? match[1] : null;
}
export function extractDateTime(input) {
    const dateRegex = /(\d{1,2}[.:]\d{1,2}[.:]\d{4})Show (\d{1,2}[.:]\d{2})/;
    const match = input.match(dateRegex);
    if (match) {
        const [, dateStr, timeStr] = match;
        const [day, month, year] = dateStr.split(/[.:]/).map(Number);
        const [hours, minutes] = timeStr.split(/[.:]/).map(Number);
        const date = new Date(year, month - 1, day, hours, minutes);
        return date;
    } else {
        return null;
    }
}
export function extractIdFromUrl(url) {
    const regex = /\/member\/detail\/id\/(\d+)/;
    const match = url.match(regex);
    if (match && match[1]) {
        return match[1];
    } else {
        return '0';
    }
}
export function extractTeamId(filename) {
    const parts = filename.split('.');
    if (parts.length >= 2) {
        return parts[1];
    } else {
        return null;
    }
}
export function extractDateCalendar(input) {
    const match = input.match(/^\d+/);
    if (match !== null) {
        const number = Number.parseInt(match[0], 10);
        return Number.isNaN(number) ? null : number;
    }
    return null;
}
export function extractYearAndMonthFromUrl(url) {
    const regex = /\/y\/(\d{4})\/m\/(\d{1,2})\//;
    const match = url.match(regex);
    if (match && match.length === 3) {
        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        return {
            year,
            month
        };
    }
    return {
        year: null,
        month: null
    };
}
export function extractNewsId(url) {
    const regex = /\/id\/(\d+)/;
    const match = url.match(regex);
    if (match && match[1]) {
        return match[1];
    } else {
        return null;
    }
}
