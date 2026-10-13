const fansMaxSize = 50;
export const fansPointWeights = {
    stage: 0.5,
    comment: 10,
    gift: 1
};
export function calculateFansPoints(usersData, stageList, giftLog = []) {
    const fansRanks = new Map();
    const users = new Map();
    for (const user of usersData){
        users.set(user.user_id, {
            name: user.name,
            avatar_id: user.avatar_id || 1,
            id: user.user_id
        });
        const currentPoint = fansRanks.get(user.user_id) ?? 0;
        fansRanks.set(user.user_id, currentPoint + (user.comments ?? 0) * fansPointWeights.comment);
    }
    for (const stage of stageList ?? []){
        for (const [i, id] of stage.list.entries()){
            const point = getRankPoints(i) * fansPointWeights.stage;
            if (fansRanks.has(id)) {
                fansRanks.set(id, (fansRanks.get(id) ?? 0) + point);
            } else {
                fansRanks.set(id, point);
            }
        }
    }
    for (const gift of giftLog){
        const currentPoint = fansRanks.get(gift.user_id) ?? 0;
        fansRanks.set(gift.user_id, currentPoint + (gift.total ?? 0) * fansPointWeights.gift);
    }
    return Array.from(fansRanks, ([user_id, fans_point])=>{
        const user = users.get(user_id) ?? {
            name: 'User not found!',
            avatar_id: 1
        };
        return {
            id: Number(user_id),
            name: user.name,
            avatar_id: user.avatar_id,
            fans_point
        };
    }).sort((a, b)=>b.fans_point - a.fans_point).slice(0, fansMaxSize);
}
function getRankPoints(rank) {
    return 100 - rank + 1;
}
