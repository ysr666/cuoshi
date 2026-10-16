/**
 * Future backend WeChat identity adapter. This is NOT imported by v0.4,
 * has NO HTTP listener, and requires official jscode2session credentials.
 */
import {createHmac,randomBytes} from 'node:crypto'
import {issueServerSession} from './sessionTokens'
import type {DbPool,DbClient} from './repository'

export type WechatVerifiedIdentity={openid:string}
export type WechatExchange=(code:string)=>Promise<WechatVerifiedIdentity>
export type WechatAuthConfig={
  appId:string
  codePepper:Uint8Array
  subjectPepper:Uint8Array
  backupSigningKey:Uint8Array
  nowSeconds:()=>number
}
export type WechatLogin={userId:string;deviceId:string;isNewAccount:boolean;accessToken:string}
const appIdPattern=/^wx[A-Za-z0-9]{16}$/
const idPattern=/^[A-Za-z0-9_-]{8,128}$/
const loginCodePattern=/^[A-Za-z0-9_-]{8,512}$/
function strongSecret(x:Uint8Array){
  return x instanceof Uint8Array&&x.byteLength>=32
}
function hashKeyed(key:Uint8Array,...values:string[]){
  return createHmac('sha256',key).update(values.map(x=>x.length+':'+x).join('|')).digest('hex')
}
export function makeWechatCodeExchanger(
  opts:{appId:string;appSecret:string;fetchImpl?:typeof fetch}
):WechatExchange{
  if(!appIdPattern.test(opts.appId)||typeof opts.appSecret!=='string'||
     opts.appSecret.length<16)throw Error('wechat_provider_not_configured')
  const request=opts.fetchImpl??fetch
  return async(code:string)=>{
    if(!loginCodePattern.test(code))throw Error('invalid_login_code')
    const endpoint=new URL('https://api.weixin.qq.com/sns/jscode2session')
    endpoint.searchParams.set('appid',opts.appId)
    endpoint.searchParams.set('secret',opts.appSecret)
    endpoint.searchParams.set('js_code',code)
    endpoint.searchParams.set('grant_type','authorization_code')
    let response:Response
    try{
      response=await request(endpoint.toString(),{
        method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)
      })
    }catch{throw Error('wechat_exchange_unavailable')}
    if(!response.ok)throw Error('wechat_exchange_failed')
    let payload:any
    try{
      const length=Number(response.headers.get('content-length')||'0')
      if(length>4096)throw Error('large response')
      const body=await response.text()
      if(body.length>4096)throw Error('large response')
      payload=JSON.parse(body)
    }catch{throw Error('wechat_exchange_invalid_response')}
    if(!payload||typeof payload!=='object'||payload.errcode!==undefined&&payload.errcode!==0)
      throw Error('wechat_exchange_failed')
    if(typeof payload.openid!=='string'||!idPattern.test(payload.openid))
      throw Error('wechat_exchange_invalid_response')
    // Never persist, log, or return the provider session_key.
    return {openid:payload.openid}
  }
}
/** Must be called only by server code with the result of genuine code exchange. */
export async function loginWithWechatCode(
  pool:DbPool,code:string,deviceId:string,config:WechatAuthConfig,
  exchange:WechatExchange
):Promise<WechatLogin>{
  if(typeof code!=='string'||!loginCodePattern.test(code)||
     !idPattern.test(deviceId)||!config||!appIdPattern.test(config.appId)||
     !strongSecret(config.codePepper)||!strongSecret(config.subjectPepper)||
     !strongSecret(config.backupSigningKey)||typeof exchange!=='function')
    throw Error('invalid_wechat_login')
  const now=config.nowSeconds()
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_server_clock')
  const identity=await exchange(code)
  if(!identity||typeof identity.openid!=='string'||!idPattern.test(identity.openid))
    throw Error('wechat_identity_not_verified')
  const codeDigest=hashKeyed(config.codePepper,config.appId,code)
  const subjectDigest=hashKeyed(config.subjectPepper,config.appId,identity.openid)
  const freshId=randomBytes(16).toString('hex')
  const db=await pool.connect()
  let opened=false
  let result:{userId:string;isNewAccount:boolean}
  try{
    await db.query('BEGIN')
    opened=true
    // Prevent replay even with a permissive/mock exchange adapter.
    const consumed=await db.query(
      'INSERT INTO cloud_consumed_wechat_codes(code_digest) VALUES($1) ON CONFLICT DO NOTHING RETURNING code_digest',
      [codeDigest]
    )
    if(!consumed.rows.length)throw Error('wechat_code_already_used')
    // Serialize initial creation for the same WeChat identity. Unlike an
    // insert-then-delete scheme, this does not grant the auth runtime any
    // DELETE permission on cloud_users (which could cascade to user backups).
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[subjectDigest])
    const old=await db.query(
      'SELECT user_id FROM cloud_wechat_identities WHERE app_id=$1 AND subject_digest=$2',
      [config.appId,subjectDigest]
    )
    if(old.rows.length)result={userId:old.rows[0].user_id,isNewAccount:false}
    else{
      // Concurrency-safe under unique index: an existing identity wins.
      await db.query('INSERT INTO cloud_users(user_id) VALUES($1)',[freshId])
      const inserted=await db.query(
        'INSERT INTO cloud_wechat_identities(app_id,subject_digest,user_id) VALUES($1,$2,$3) RETURNING user_id',
        [config.appId,subjectDigest,freshId]
      )
      if(!inserted.rows.length)throw Error('wechat_identity_conflict')
      result={userId:freshId,isNewAccount:true}
    }
    await db.query('COMMIT')
    opened=false
  }catch(err){
    if(opened){try{await db.query('ROLLBACK')}catch{}}
    throw err
  }finally{db.release()}
  // A signed session is issued only after an authenticated exchange AND a
  // successful identity mapping transaction. Keys stay server-side.
  return {
    ...result,deviceId,
    accessToken:issueServerSession(
      {aud:'cuoshi-cloud-backup',sub:result.userId,deviceId},
      config.backupSigningKey,now
    )
  }
}
