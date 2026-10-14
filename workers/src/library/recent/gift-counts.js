export function giftCounts(logs,id){
 let num=0,send_count=0,known=true;const users=new Set();
 for(const log of logs||[])for(const gift of log.gifts||[])if(String(gift.gift_id)===String(id)){
  num+=Number(gift.num??1);if(Number.isInteger(gift.send_count))send_count+=gift.send_count;else known=false;users.add(String(log.user_id));
 }
 return {num,send_count:known?send_count:null,user_count:users.size};
}
