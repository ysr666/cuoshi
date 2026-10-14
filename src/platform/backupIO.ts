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
    const path=wx.env.USER_DATA_PATH+'/'+filename
    wx.getFileSystemManager().writeFileSync(path,text,'utf8')
    if(typeof wx.shareFileMessage==='function'){
      await new Promise<void>((resolve,reject)=>wx.shareFileMessage({filePath:path,fileName:filename,success:()=>resolve(),fail:(error:unknown)=>reject(error)}))
      return '文件已交给微信分享界面，请自行保存到安全位置'
    }
    throw Error('备份已暂存在小程序内，但当前微信不支持直接分享文件；请升级微信后重试')
  }
  // #endif
  throw Error('当前运行平台暂不支持文件导出，请在支持的 H5 或微信小程序端操作')
}
export async function selectBackupFile():Promise<string>{
  // #ifdef H5
  if(typeof document!=='undefined')return new Promise((resolve,reject)=>{
    const el=document.createElement('input');el.type='file';el.accept='.json,application/json'
    el.style.display='none';document.body.appendChild(el)
    el.addEventListener('change',async ()=>{
      try{const file=el.files?.[0];if(!file){reject(Error('已取消选择'));return}if(file.size>15*1024*1024)throw Error('备份文件超过 15 MB');resolve(await file.text())}catch(e){reject(e)}finally{el.remove()}
    });el.click()
  })
  // #endif
  // #ifdef MP-WEIXIN
  if(typeof wx!=='undefined'&&wx.chooseMessageFile)return new Promise((resolve,reject)=>{
    wx.chooseMessageFile({count:1,type:'file',extension:['json'],success:(r:any)=>{
      try{const f=r.tempFiles?.[0];if(!f)throw Error('没有选择文件');if(f.size>15*1024*1024)throw Error('备份文件超过 15 MB');resolve(wx.getFileSystemManager().readFileSync(f.path,'utf8'))}catch(e){reject(e)}
    },fail:()=>reject(Error('已取消选择，或微信无法读取此文件'))})
  })
  // #endif
  throw Error('当前平台暂不支持读取 JSON 文件')
}
