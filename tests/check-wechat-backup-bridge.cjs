/** WeChat backup bridge contract (no real user files or accounts).
 * Exercises production backupIO.ts with a simulated native WeChat API.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../src/platform/backupIO.ts'),'utf8');
const code=ts.transpileModule(src,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;

function launch(wx){
  const module={exports:{}};
  const sandbox={module,exports:module.exports,wx,console,Date,Math,Promise,setTimeout,clearTimeout};
  vm.runInNewContext(code,sandbox,{filename:'backupIO.transpiled.js'});
  return module.exports;
}
function stub(){
  const data=new Map(),shared=[],writes=[],removals=[],read=[];
  let outcome='success',chooser='success',readError=false;
  const manager={
    writeFileSync(file,body,encoding){
      assert.equal(encoding,'utf8');
      writes.push(file);data.set(file,body);
    },
    unlinkSync(file){removals.push(file);if(!data.delete(file))throw Error('missing file');},
    readFileSync(file,encoding){
      assert.equal(encoding,'utf8');read.push(file);
      if(readError)throw Error('file permission denied');
      if(!data.has(file))throw Error('missing file');
      return data.get(file);
    }
  };
  const wx={
    env:{USER_DATA_PATH:'wxfile://cuoshi-qa-only'},
    getFileSystemManager:()=>manager,
    shareFileMessage(options){
      assert.match(options.fileName,/\.json$/);
      assert.ok(options.filePath.startsWith(wx.env.USER_DATA_PATH+'/'));
      assert.ok(data.has(options.filePath),'WeChat must receive a file before cleanup');
      shared.push({fileName:options.fileName,filePath:options.filePath,body:data.get(options.filePath)});
      if(outcome==='fail')options.fail({errMsg:'shareFileMessage:fail user cancel'});
      else options.success();
    },
    chooseMessageFile(options){
      assert.equal(options.count,1);
      assert.equal(options.type,'file');
      if(chooser==='cancel')return options.fail({errMsg:'chooseMessageFile:fail cancel'});
      if(chooser==='permission')return options.fail({errMsg:'chooseMessageFile:fail permission denied'});
      if(chooser==='oversized')return options.success({tempFiles:[{path:'chat://file.json',size:16*1024*1024}]});
      options.success({tempFiles:[{path:'chat://file.json',size:128}]});
    }
  };
  return {wx,data,shared,writes,removals,read,
    setShare:v=>outcome=v,setChooser:v=>chooser=v,setReadError:v=>readError=v};
}

(async()=>{
 let checks=0;
 function ok(value,message){assert.ok(value,message);checks++;}
 const env=stub(),io=launch(env.wx);
 const payload=JSON.stringify({version:1,notes:['敏感测试文字📝','昨天现在觉得不算错了'],events:[1,2]});
 const name='错事备份_2026-10-16.json';
 const message=await io.saveBackupFile(payload,name);
 ok(message.includes('确认文件存在'),'Share callback does not prove durable delivery');
 ok(env.shared.length===1,'One explicit share event');
 ok(env.shared[0].body===payload,'Shared plaintext JSON bytes preserved');
 ok(env.shared[0].fileName===name,'Friendly file name preserved');
 ok(env.data.size===0&&env.removals.length===1,'Temporary plaintext removed after successful share');

 // User may cancel/decline chat sharing. No abandoned local JSON should remain.
 env.setShare('fail');
 await assert.rejects(io.saveBackupFile(payload,name),/已取消文件分享/);checks++;
 ok(env.data.size===0&&env.removals.length===2,'Share failure cleans the temporary plaintext file');
 env.setShare('success');
 const noShare=stub();
 delete noShare.wx.shareFileMessage;
 const ioNoShare=launch(noShare.wx);
 await assert.rejects(ioNoShare.saveBackupFile(payload,name),/不支持文件分享/);checks++;
 ok(noShare.data.size===0,'Unsupported API must not write an orphan file');
 const failures=stub();
 let cleanedPartial=false;
 failures.wx.getFileSystemManager=()=>({
   writeFileSync(file){failures.data.set(file,'partial private data');throw Error('storage full')},
   unlinkSync(file){cleanedPartial=failures.data.delete(file)}
 });
 await assert.rejects(launch(failures.wx).saveBackupFile(payload,name),/storage full/);checks++;
 ok(cleanedPartial&&failures.data.size===0,'Partial write failure cannot leave private JSON in mini-program storage');

 // A user-selected file from chat returns exactly the bytes that were shared.
 env.data.set('chat://file.json',env.shared[0].body);
 const selected=await io.selectBackupFile();
 ok(selected===payload,'Share → chat file chooser → read roundtrip is byte exact');
 ok(env.read.at(-1)==='chat://file.json','Only the explicitly chosen chat file was read');
 env.setChooser('cancel');
 await assert.rejects(io.selectBackupFile(),/已取消选择/);checks++;
 env.setChooser('permission');
 await assert.rejects(io.selectBackupFile(),/选择备份文件失败/);checks++;
 env.setChooser('oversized');
 await assert.rejects(io.selectBackupFile(),/15 MB/);checks++;
 env.setChooser('success');env.setReadError(true);
 await assert.rejects(io.selectBackupFile(),/permission denied/);checks++;
 env.setReadError(false);
 const noChooser=stub();
 delete noChooser.wx.chooseMessageFile;
 await assert.rejects(launch(noChooser.wx).selectBackupFile(),/不支持读取 JSON/);checks++;

 // Two successive exports must not clobber one another's paths.
 await io.saveBackupFile(payload,name);
 await io.saveBackupFile(payload,name);
 ok(new Set(env.writes).size===env.writes.length,'All export staging paths are unique');
 ok(env.data.has('chat://file.json')&&env.data.size===1,'Only the user-selected chat fixture remains');
 console.log('PASS '+checks+' WeChat backup bridge checks: success, cancel, errors, size, temp hygiene, and roundtrip');
})().catch(e=>{console.error('FAIL WeChat backup bridge',e.stack||e);process.exitCode=1});
