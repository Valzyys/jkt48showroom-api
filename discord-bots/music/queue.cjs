const {MusicError}=require('./source.cjs');
class MusicQueue{
 constructor(){this.items=[]}
 add(track){if(this.items.length>=25)throw new MusicError('Antrean penuh, maksimal 25 lagu.');if(this.items.filter(t=>t.requestedBy===track.requestedBy).length>=5)throw new MusicError('Maksimal lima lagu dalam antrean per orang.');this.items.push(track);return this.items.length}
 shift(){return this.items.shift()}
 clear(){this.items.length=0}
 shuffle(random=Math.random){for(let i=this.items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[this.items[i],this.items[j]]=[this.items[j],this.items[i]]}}
}
module.exports={MusicQueue};
