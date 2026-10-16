/** Stable content serialization for future cloud revisions.
 * PostgreSQL jsonb may reorder object properties: canonical JSON in v0.4 is
 * intentionally unchanged; future cloud uses a distinct stable digest.
 */
export function stableJson(value:unknown):string{
  if(value===null)return 'null'
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']'
  if(typeof value==='object'){
    const record=value as Record<string,unknown>
    return '{'+Object.keys(record).filter(k=>record[k]!==undefined).sort()
      .map(k=>JSON.stringify(k)+':'+stableJson(record[k])).join(',')+'}'
  }
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value)
  throw Error('invalid_cloud_json')
}
