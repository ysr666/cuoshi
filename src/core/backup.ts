/** Portable JSON backups. V2 checksum is compatible with the existing v0.3.1 H5 backup. */
import {cloneState,validate,type Records} from './model'
export type Backup = Records & {exportedAt?:string;backupFormat?:2;checksumSha256?:string}
function utf8(src:string):number[]{
  const bytes:number[]=[]
  for(let i=0;i<src.length;i++){
    let cp=src.charCodeAt(i)
    if(cp>=0xd800&&cp<=0xdbff&&i+1<src.length){const lo=src.charCodeAt(i+1);if(lo>=0xdc00&&lo<=0xdfff){cp=0x10000+(cp-0xd800)*1024+(lo-0xdc00);i++}}
    if(cp<0x80)bytes.push(cp)
    else if(cp<0x800)bytes.push(0xc0|(cp>>6),0x80|(cp&63))
    else if(cp<0x10000)bytes.push(0xe0|(cp>>12),0x80|((cp>>6)&63),0x80|(cp&63))
    else bytes.push(0xf0|(cp>>18),0x80|((cp>>12)&63),0x80|((cp>>6)&63),0x80|(cp&63))
  }
  return bytes
}
// Unoptimized, dependency-free SHA-256 works in mini-program JS runtimes without WebCrypto.
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n))
export function sha256(src:string):string{
  const data=utf8(src),bits=data.length*8
  data.push(128);while(data.length%64!==56)data.push(0)
  const high=Math.floor(bits/0x100000000),low=bits>>>0
  for(let i=3;i>=0;i--)data.push((high>>>(i*8))&255)
  for(let i=3;i>=0;i--)data.push((low>>>(i*8))&255)
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  for(let offset=0;offset<data.length;offset+=64){
    const w=new Array<number>(64)
    for(let i=0;i<16;i++){const p=offset+4*i;w[i]=((data[p]<<24)|(data[p+1]<<16)|(data[p+2]<<8)|data[p+3])>>>0}
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(((rotr(b,17)^rotr(b,19)^(b>>>10))+w[i-7]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-16])>>>0)}
    let [a,b,c,d,e,f,g,j]=h
    for(let i=0;i<64;i++){const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
    for(const [i,v] of [a,b,c,d,e,f,g,j].entries())h[i]=(h[i]+v)>>>0
  }
  return h.map(v=>v.toString(16).padStart(8,'0')).join('')
}
export function canonical(s:Records):string{return JSON.stringify({version:s.version,theme:s.theme,days:s.days,events:s.events})}
export function exportBackup(s:Records):string{
  validate(s);const cloned=cloneState(s)
  return JSON.stringify({...cloned,exportedAt:new Date().toISOString(),backupFormat:2,checksumSha256:sha256(canonical(cloned))},null,2)
}
export function parseBackup(source:string):Records{
  if(source.length>15*1024*1024)throw Error('备份文件超过 15 MB')
  const data=JSON.parse(source) as Backup & {encryptedFormat?:number}
  if(data.encryptedFormat)throw Error('加密备份请先在原网页版使用密码解密并导出普通 JSON；小程序解密功能尚未开放')
  validate(data)
  if(data.backupFormat===2){if(!/^[a-f0-9]{64}$/.test(data.checksumSha256||'')||sha256(canonical(data))!==data.checksumSha256)throw Error('备份校验失败，文件可能被修改')}
  else if(data.backupFormat!==undefined)throw Error('不支持该备份格式')
  return {version:1,theme:data.theme,days:data.days,events:data.events}
}
