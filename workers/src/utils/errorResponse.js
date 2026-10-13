export class ApiError extends Error {
    data;
    constructor(data){
        super(data?.error?.message || data?.message || 'Unknown Error!');
        this.data = data;
    }
    toJSON() {
        return {
            ...this.data
        };
    }
}
export function createError(data) {
    return new ApiError({
        error: data.error,
        status: data.statusCode || data.status || 500,
        message: data.statusMessage || data.message || 'An error occured!'
    });
}
export function notFound() {
    return createError({
        status: 404,
        message: 'Not found!'
    });
}
export function unauthorized() {
    return createError({
        status: 401,
        message: 'Unauthorized!'
    });
}
