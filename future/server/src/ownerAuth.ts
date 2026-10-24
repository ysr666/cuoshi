/** Sole owner: slow salted password verifier, RFC6238 TOTP + SQL anti-replay.
 * This file never provisions extra human accounts or imports user backups.
 */
import {createHmac,timingSafeEqual,scrypt as scryptCallback} from 'node:crypto'
import {isIP} from 'node:net'
import {issueServerSession,verifyServerSession} from './sessionTokens'
import {revokeVerifiedSession,ensureSessionNotRevoked} from './sessionRevocation'
import type {DbPool} from './repository'
const derive=(value:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>{
 scryptCallback(value,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024},(error,bytes)=>
   error?reject(error):resolve(bytes as Buffer))
})
export type OwnerLoginSettings={ownerId:string;passwordRecord:string;totpSecret:string;
 signingKey:Uint8Array;peerHashKey:Uint8Array}
function decodeBase32(raw:string){
 if(!/^[A-Z2-7]{32,128}$/.test(raw))throw Error('owner_totp_secret_invalid')
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
 let bits=0,value=0
 const result:number[]=[]
 for(const letter of raw){
   value=(value<<5)|alphabet.indexOf(letter);bits+=5
   if(bits>=8){bits-=8;result.push((value>>bits)&255)}
 }
 if(result.length<20||result.length>80)throw Error('owner_totp_secret_invalid')
 return Buffer.from(result)
}
function parsePasswordRecord(raw:string){
 const parts=typeof raw==='string'?raw.split(':'):[]
 if(parts.length!==4||parts[0]!=='scrypt'||parts[1]!=='16384'||
   !/^[a-f0-9]{32}$/.test(parts[2]??'')||
   !/^[a-f0-9]{64}$/.test(parts[3]??''))
   throw Error('owner_password_hash_invalid')
 return {salt:Buffer.from(parts[2],'hex'),hash:Buffer.from(parts[3],'hex')}
}
export function validateOwnerLoginSettings(settings:OwnerLoginSettings){
 if(!settings||typeof settings.ownerId!=='string'||
   !/^[A-Za-z0-9_-]{8,128}$/.test(settings.ownerId)||
   !(settings.signingKey instanceof Uint8Array)||settings.signingKey.length<32||
   !(settings.peerHashKey instanceof Uint8Array)||settings.peerHashKey.length<32||
   Buffer.from(settings.signingKey).equals(Buffer.from(settings.peerHashKey)))
    throw Error('owner_auth_config_invalid')
 return {password:parsePasswordRecord(settings.passwordRecord),
   totp:decodeBase32(settings.totpSecret)}
}
function totpAt(key:Buffer,step:number){
 const input=Buffer.alloc(8);input.writeBigUInt64BE(BigInt(step))
 const mac=createHmac('sha1',key).update(input).digest()
 const offset=mac[mac.length-1]&0xf
 return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
function verifyOtp(key:Buffer,otp:string,nowSeconds:number):number|null{
 if(!/^\d{6}$/.test(otp)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0)return null
 const step=Math.floor(nowSeconds/30)
 let matched:number|null=null
 for(const candidate of [step-1,step,step+1]){
   if(candidate<0)continue
   const expected=Buffer.from(totpAt(key,candidate),'ascii')
   if(timingSafeEqual(expected,Buffer.from(otp,'ascii')))matched=candidate
 }
 return matched
}
export function createOwnerAuthService(
 db:DbPool,settings:OwnerLoginSettings,
 nowSeconds:()=>number=()=>Math.floor(Date.now()/1000)
){
 if(typeof db?.connect!=='function')throw Error('owner_auth_database_missing')
 const {password,totp}=validateOwnerLoginSettings(settings)
 return {
  async login(input:{password:string;otp:string},peer:string){
   if(typeof peer!=='string'||!isIP(peer))throw Error('owner_login_peer_unverified')
   const digest=createHmac('sha256',settings.peerHashKey)
     .update('cuoshi-owner-login-ip-v1:').update(peer.toLowerCase()).digest('hex')
   const c=await db.connect()
   let allowed=false
   try{const result=await c.query('SELECT cloud_take_owner_login_slot($1) AS allowed',[digest]);
     allowed=result.rows.length===1&&result.rows[0].allowed===true
   }finally{c.release()}
   if(!allowed)throw Error('owner_login_rate_limited')
   if(!input||typeof input.password!=='string'||typeof input.otp!=='string'||
      input.password.length<12||input.password.length>128||
      Buffer.byteLength(input.password,'utf8')>256||!/^\d{6}$/.test(input.otp))
      throw Error('owner_login_invalid')
   const derived=await derive(input.password,password.salt)
   const good=timingSafeEqual(derived,password.hash)
   const time=nowSeconds(),step=verifyOtp(totp,input.otp,time)
   if(!good||step===null)throw Error('owner_login_invalid')
   // Consume time-step atomically, after checking active owner role. A reused
   // code fails even across process restarts or multiple service workers.
   const client=await db.connect()
   let consumed=false
   try{
     const result=await client.query('SELECT cloud_consume_owner_totp_step($1,$2) AS accepted',
       [settings.ownerId,step])
     consumed=result.rows.length===1&&result.rows[0].accepted===true
   }finally{client.release()}
   if(!consumed)throw Error('owner_login_invalid')
   return issueServerSession({aud:'cuoshi-staff-admin',sub:settings.ownerId,mfaAt:time},
      settings.signingKey,time)
  },
  async logout(rawToken:string){
   const claims=verifyServerSession(rawToken,settings.signingKey,'cuoshi-staff-admin',nowSeconds())
   if(!claims||claims.sub!==settings.ownerId)throw Error('unauthorized')
   await ensureSessionNotRevoked(db,claims)
   await revokeVerifiedSession(db,claims)
  }
 }
}
