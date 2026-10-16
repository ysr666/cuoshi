/**
 * Offline server-side session token boundary.
 * Tokens must ONLY be issued after future verified WeChat/phone or staff MFA auth.
 * Never mint tokens from a client-supplied openid/phone/userId.
 *
 * No HTTP listener, provider credentials, demo backdoor, or client import.
 */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto'

export type SessionAudience='cuoshi-cloud-backup'|'cuoshi-staff-admin'
export type SessionClaims={
  iss:'cuoshi-server'
  aud:SessionAudience
  sub:string
  jti:string
  iat:number
  exp:number
  deviceId?:string
  mfaAt?:number
  generation?:number
}
const safeId=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(s)
const maxLifetime={ 'cuoshi-cloud-backup':15*60,'cuoshi-staff-admin':5*60 }
const HEADER='eyJhbGciOiJIUzI1NiIsInR5cCI6IkNVU0hJLURFTU8ifQ' // {'alg':'HS256','typ':'CUSHI-DEMO'}
function requireSecret(secret:Uint8Array){
  if(!(secret instanceof Uint8Array)||secret.byteLength<32)throw Error('session_secret_not_configured')
}
function hmac(payload:string,secret:Uint8Array){
  return createHmac('sha256',secret).update(HEADER+'.'+payload).digest()
}
/** Only backend auth orchestration is allowed to invoke this after provider verification. */
export function issueServerSession(
  identity:{aud:SessionAudience;sub:string;deviceId?:string;mfaAt?:number;generation?:number},
  secret:Uint8Array,nowSeconds:number
):string{
  requireSecret(secret)
  if(!identity||!safeId(identity.sub)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0)
    throw Error('invalid_session_claims')
  if(identity.generation!==undefined&&(!Number.isSafeInteger(identity.generation)||identity.generation<0))
    throw Error('invalid_session_generation')
  if(identity.aud==='cuoshi-cloud-backup'){
    if(!safeId(identity.deviceId)||identity.mfaAt!==undefined)throw Error('invalid_session_claims')
  }else if(identity.aud==='cuoshi-staff-admin'){
    if(identity.deviceId!==undefined||typeof identity.mfaAt!=='number'||!Number.isSafeInteger(identity.mfaAt)||
       identity.mfaAt>nowSeconds||nowSeconds-identity.mfaAt>5*60)
      throw Error('staff_mfa_required')
  }else throw Error('invalid_session_audience')
  const claims:SessionClaims={
    iss:'cuoshi-server',aud:identity.aud,sub:identity.sub,
    iat:nowSeconds,exp:nowSeconds+maxLifetime[identity.aud],
    jti:randomBytes(16).toString('hex'),generation:identity.generation??0,
    ...(identity.aud==='cuoshi-cloud-backup'?{deviceId:identity.deviceId}:{mfaAt:identity.mfaAt})
  }
  const encoded=Buffer.from(JSON.stringify(claims),'utf8').toString('base64url')
  return HEADER+'.'+encoded+'.'+hmac(encoded,secret).toString('base64url')
}
/**
 * Server-only verification; separate staff and user signing keys in production.
 * Returns null on ANY failure and never logs the raw token or private claims.
 */
export function verifyServerSession(
  token:unknown,secret:Uint8Array,audience:SessionAudience,nowSeconds:number
):SessionClaims|null{
  requireSecret(secret)
  if(typeof token!=='string'||token.length>1800||token.length<90||
     !Number.isSafeInteger(nowSeconds)||nowSeconds<0)return null
  const parts=token.split('.')
  if(parts.length!==3||parts[0]!==HEADER||
     !/^[a-zA-Z0-9_-]+$/.test(parts[1])||!/^[a-zA-Z0-9_-]{43}$/.test(parts[2]))
    return null
  const signature=Buffer.from(parts[2],'base64url')
  const computed=hmac(parts[1],secret)
  if(signature.length!==computed.length||!timingSafeEqual(signature,computed))return null
  let claims:SessionClaims
  try{
    const decoded=Buffer.from(parts[1],'base64url')
    if(decoded.toString('base64url')!==parts[1])return null
    claims=JSON.parse(decoded.toString('utf8')) as SessionClaims
  }catch{return null}
  if(!claims||claims.iss!=='cuoshi-server'||claims.aud!==audience||
     !safeId(claims.sub)||!safeId(claims.jti)||
     (claims.generation!==undefined&&(!Number.isSafeInteger(claims.generation)||claims.generation<0))||
     !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
     claims.iat>nowSeconds||claims.iat<nowSeconds-24*60*60||
     claims.exp<=nowSeconds||claims.exp<=claims.iat||
     claims.exp-claims.iat>maxLifetime[audience])return null
  if(audience==='cuoshi-cloud-backup'){
    if(!safeId(claims.deviceId)||claims.mfaAt!==undefined)return null
  }else if(audience==='cuoshi-staff-admin'){
    if(claims.deviceId!==undefined||typeof claims.mfaAt!=='number'||!Number.isSafeInteger(claims.mfaAt)||
       claims.mfaAt>nowSeconds||nowSeconds-claims.mfaAt>5*60)return null
  }else return null
  return claims
}
