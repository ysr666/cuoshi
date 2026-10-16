/** Explicit per-platform backup handoff; no data is uploaded. */
declare const wx:any
export async function saveBackupFile(text:string,filename:string):Promise<string>{
  // #ifdef H5
  if(typeof document!=='undefined'){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove()
    setTimeout(()=>URL.revokeObjectURL(url),4000)
    return '已发起下载，请在文件 App 或下载目录确认备份确实保存'
  }
  // #endif
  // #ifdef MP-WEIXIN
  if(typeof wx!=='undefined'&&wx.getFileSystemManager){
    if(typeof wx.shareFileMessage!=='function')throw Error('当前微信不支持文件分享，请升级微信后重试')
    const fs=wx.getFileSystemManager()
    // A fresh path avoids overwriting another unfinished export from the same day.
    const tempName='cuoshi-export-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)+'.json'
    const path=wx.env.USER_DATA_PATH+'/'+tempName
    let writeAttempted=false
    try{
      writeAttempted=true
      fs.writeFileSync(path,text,'utf8')
      await new Promise<void>((resolve,reject)=>wx.shareFileMessage({
        filePath:path,fileName:filename,
        success:()=>resolve(),
        fail:(error:any)=>reject(Error(/cancel|取消/i.test(String(error?.errMsg||''))?'已取消文件分享':'微信文件分享失败，请检查权限并重试'))
      }))
      return '文件已交给微信分享流程，请在所选聊天中确认文件存在并另行保管'
    }finally{
      // Export files contain plaintext notes and change history. They are not
      // intended to become permanent untracked copies in mini-program storage.
      if(writeAttempted){
        try{fs.unlinkSync(path)}catch(error){console.warn('临时备份清理失败',error)}
      }
    }
  }
  // #endif
  throw Error('当前运行平台暂不支持文件导出，请在支持的 H5 或微信小程序端操作')
}
export async function selectBackupFile():Promise<string>{
  // #ifdef H5
  if(typeof document!=='undefined')return new Promise<string>((resolve,reject)=>{
    const el=document.createElement('input');el.type='file';el.accept='.json,application/json'
    el.style.display='none';document.body.appendChild(el)
    let finished=false
    let focusTimer:ReturnType<typeof setTimeout>|undefined
    function finish():boolean{
      if(finished)return false
      finished=true
      if(focusTimer)clearTimeout(focusTimer)
      window.removeEventListener('focus',onFocus)
      el.remove()
      return true
    }
    function cancel(){if(finish())reject(Error('已取消选择'))}
    function onFocus(){
      // Fallback for older webviews that don't dispatch the file input's cancel event.
      focusTimer=setTimeout(()=>{if(!el.files?.length)cancel()},600)
    }
    if(!('oncancel' in el))window.addEventListener('focus',onFocus)
    el.addEventListener('cancel',cancel,{once:true})
    el.addEventListener('change',async ()=>{
      try{
        const file=el.files?.[0]
        if(!file){cancel();return}
        if(file.size>15*1024*1024)throw Error('备份文件超过 15 MB')
        const content=await file.text()
        if(finish())resolve(content)
      }catch(e){if(finish())reject(e)}
    },{once:true})
    try{el.click()}catch(e){if(finish())reject(e)}
  })
  // #endif
  // #ifdef MP-WEIXIN
  if(typeof wx!=='undefined'&&wx.chooseMessageFile)return new Promise((resolve,reject)=>{
    wx.chooseMessageFile({count:1,type:'file',extension:['json'],success:(r:any)=>{
      try{const f=r.tempFiles?.[0];if(!f)throw Error('没有选择文件');if(f.size>15*1024*1024)throw Error('备份文件超过 15 MB');resolve(wx.getFileSystemManager().readFileSync(f.path,'utf8'))}catch(e){reject(e)}
    },fail:(error:any)=>{
      const msg=String(error?.errMsg||error?.message||'')
      reject(Error(/cancel|取消/i.test(msg)?'已取消选择':'选择备份文件失败，请检查微信聊天文件与访问权限'))
    }})
  })
  // #endif
  throw Error('当前平台暂不支持读取 JSON 文件')
}
