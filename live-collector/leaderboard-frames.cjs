// Trim only near-black side bars for the artwork; archived screenshots remain intact.
module.exports=async page=>page.evaluate(async()=>{
 for(const image of document.querySelectorAll('.frame img')){
  try{
   await image.decode();const sample=document.createElement('canvas');sample.width=160;sample.height=160;const context=sample.getContext('2d');context.drawImage(image,0,0,160,160);const pixels=context.getImageData(0,0,160,160).data;
   const black=x=>{let dark=0;for(let y=0;y<160;y++){const i=(y*160+x)*4;if(pixels[i]<22&&pixels[i+1]<22&&pixels[i+2]<22)dark++}return dark>154};
   let left=0,right=159;while(left<64&&black(left))left++;while(right>95&&black(right))right--;
   if(left<4&&right>155)continue;if(right-left<64)continue;
   const canvas=document.createElement('canvas'),scale=image.naturalWidth/160;canvas.width=Math.round((right-left+1)*scale);canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,Math.round(left*scale),0,canvas.width,canvas.height,0,0,canvas.width,canvas.height);image.src=canvas.toDataURL('image/jpeg',.94);await image.decode();
  }catch{/* Images without CORS permission retain their original framing. */}
 }
});
