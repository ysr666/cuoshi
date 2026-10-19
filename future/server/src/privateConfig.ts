/**
 * Strict startup contract for a future private cloud service behind a local
 * authenticated TLS-terminating edge. All values stay server-side. A valid
 * config is NOT by itself production or compliance authorization.
 */
export type PrivateCloudConfig={
  port:number
  appId:string
  appSecret:string
  backupDbUrl:string
  identityDbUrl:string
  staffDbUrl:string
  cancellationDbUrl:string
  dbSchema:string
  backupSigningKey:Uint8Array
  staffSigningKey:Uint8Array
  subjectPepper:Uint8Array
  codePepper:Uint8Array
  loginPeerKey:Uint8Array
  edgeSecret:Uint8Array
}
const appIdPattern=/^wx[A-Za-z0-9]{16}$/
const schemaPattern=/^[a-z][a-z0-9_]{0,62}$/
const reservedSchemas=new Set(['public','postgres','postgresql','root','admin',
  'pg_catalog','information_schema'])
/** Runtime SQL uses short unqualified names; always pin the intended schema. */
export function privateDatabaseSchema(value:unknown):string{
 if(typeof value!=='string'||!schemaPattern.test(value)||
    value.startsWith('pg_')||reservedSchemas.has(value))
   throw Error('private_cloud_database_schema_invalid')
 return value
}
/** Shared by the real service and real-PostgreSQL integration tests. */
export function privatePoolConnectionOptions(connectionString:string,schema:string,max=6){
 const verified=privateDatabaseSchema(schema)
 return {connectionString,options:'-c search_path='+verified+',pg_catalog',
   max,connectionTimeoutMillis:5000,idleTimeoutMillis:20000,
   // PostgreSQL-side guards are enforced even if Node disconnects mid-query.
   statement_timeout:15000,lock_timeout:4000,
   idle_in_transaction_session_timeout:10000,
   // Driver-side upper bound includes network and read delays.
   query_timeout:20000}
}
function secretHex(env:Record<string,string|undefined>,name:string):Uint8Array{
 const raw=env[name]
 if(typeof raw!=='string'||!/^[a-f0-9]{64}$/i.test(raw))
   throw Error('private_cloud_secret_missing_or_invalid:'+name)
 return Uint8Array.from(Buffer.from(raw,'hex'))
}
export function databaseUrl(env:Record<string,string|undefined>,name:string){
 const value=env[name]
 if(typeof value!=='string'||!value)throw Error('private_cloud_database_missing:'+name)
 let parsed:URL
 try{parsed=new URL(value)}catch{throw Error('private_cloud_database_invalid:'+name)}
 // A trusted deployment uses TLS with verified server identity. Explicitly
 // forbid database owner/admin accounts and relaxed TLS connection modes.
 if(!['postgres:','postgresql:'].includes(parsed.protocol)||
    !parsed.hostname||!parsed.username||!parsed.password||
    !parsed.pathname||parsed.pathname==='/'||parsed.hash||
    parsed.searchParams.getAll('sslmode').length!==1||
    parsed.searchParams.get('sslmode')!=='verify-full'||
    parsed.searchParams.has('options')||parsed.searchParams.has('service')||
    ['postgres','postgresql','root','admin'].includes(decodeURIComponent(parsed.username).toLowerCase()))
   throw Error('private_cloud_database_invalid:'+name)
 return {value,role:decodeURIComponent(parsed.username)}
}
export function parsePrivateCloudConfig(env:Record<string,string|undefined>):PrivateCloudConfig{
 if(!env||env.CUOSHI_PRIVATE_EDGE_ACK!=='PRIVATE_EDGE_LOOPBACK_ONLY')
   throw Error('private_cloud_explicit_ack_required')
 const portStr=env.CUOSHI_PRIVATE_PORT
 const port=Number(portStr)
 if(typeof portStr!=='string'||!/^\d{4,5}$/.test(portStr)||
    !Number.isSafeInteger(port)||port<1024||port>65535)
   throw Error('private_cloud_port_invalid')
 const appId=env.CUOSHI_WECHAT_APP_ID
 const appSecret=env.CUOSHI_WECHAT_APP_SECRET
 if(typeof appId!=='string'||!appIdPattern.test(appId)||
    typeof appSecret!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(appSecret))
   throw Error('private_cloud_wechat_config_invalid')
 const dbSchema=privateDatabaseSchema(env.CUOSHI_PG_SCHEMA)
 const urls=[
   databaseUrl(env,'CUOSHI_PG_BACKUP_URL'),
   databaseUrl(env,'CUOSHI_PG_IDENTITY_URL'),
   databaseUrl(env,'CUOSHI_PG_STAFF_URL'),
   databaseUrl(env,'CUOSHI_PG_CANCELLATION_URL')
 ]
 if(new Set(urls.map(x=>x.role)).size!==urls.length)
   throw Error('private_cloud_database_roles_not_separated')
 const keys=[
   'CUOSHI_BACKUP_SIGNING_KEY_HEX','CUOSHI_STAFF_SIGNING_KEY_HEX',
   'CUOSHI_WECHAT_SUBJECT_PEPPER_HEX','CUOSHI_WECHAT_CODE_PEPPER_HEX',
   'CUOSHI_LOGIN_PEER_HMAC_KEY_HEX','CUOSHI_EDGE_SHARED_SECRET_HEX'
 ].map(name=>secretHex(env,name))
 if(new Set(keys.map(x=>Buffer.from(x).toString('hex'))).size!==keys.length)
   throw Error('private_cloud_secrets_not_separated')
 return {
   port,appId,appSecret,dbSchema,
   backupDbUrl:urls[0].value,identityDbUrl:urls[1].value,staffDbUrl:urls[2].value,cancellationDbUrl:urls[3].value,
   backupSigningKey:keys[0],staffSigningKey:keys[1],
   subjectPepper:keys[2],codePepper:keys[3],loginPeerKey:keys[4],edgeSecret:keys[5]
 }
}
