import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
const pw=await import(pathToFileURL(process.env.PW_PATH||'D:/npm-global/node_modules/playwright/index.js').href);
const browser=await (pw.chromium||pw.default.chromium).launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader',...(process.env.PERF_SOFTWARE==='1'?['--use-angle=swiftshader']:[])]});
const results=[];
mkdirSync('test-artifacts/performance',{recursive:true});
try{
  for(const mode of ['idle','synthetic-hand','synthetic-two-hands','camera-default','camera-CPU','camera-GPU']){
    if(process.env.PERF_MODES&&!process.env.PERF_MODES.split(',').includes(mode))continue;
    const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(mode=>{
      if(mode==='camera-CPU'||mode==='camera-GPU')localStorage.setItem('sc_delegate',mode.split('-')[1]);
      window.__commits={};window.__measure=false;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(r){this.renderers.set(1,r);return 1;},onCommitFiberRoot(id,root){
        if(!window.__measure)return;
        const walk=f=>{if(!f)return;if(typeof f.type==='function'&&(f.flags&1)){const name=f.type.name;window.__commits[name]=(window.__commits[name]||0)+1;}walk(f.child);walk(f.sibling);};walk(root.current);
      },onCommitFiberUnmount(){},onPostCommitFiberRoot(){}};
    },mode);
    await page.goto(process.env.BASE||'http://127.0.0.1:5173',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'鼠标模式',exact:true}).click();await page.waitForFunction(()=>window.__spatial&&window.__three);
    await page.getByRole('button',{name:'立方体',exact:true}).click();
    if(mode.startsWith('camera-')){
      await page.locator('.cam-panel').getByRole('button',{name:'启用摄像头',exact:true}).click();
      try{await page.waitForFunction(()=>window.__spatial.handState.status==='ready'&&window.__spatial.handState.frames>4,null,{timeout:12000});}
      catch(e){const diagnostic=await page.evaluate(()=>({status:window.__spatial.handState.status,frames:window.__spatial.handState.frames,toasts:window.__spatial.useApp.getState().toasts}));results.push({mode,failed:true,diagnostic,errors});console.log(JSON.stringify({mode,failed:true,diagnostic}));await context.close();continue;}
    }
    if(mode.startsWith('synthetic-'))await page.evaluate(two=>{
      const {handState:h}=window.__spatial;let i=0;
      window.__handTimer=setInterval(()=>{
        const x=.35+Math.sin(i++*.05)*.1,y=.4,pts=Array.from({length:21},(_,k)=>({x:x+(k%4)*.01,y:y+Math.floor(k/4)*.02,z:0}));pts[8]={x,y,z:0};
        h.status='ready';h.updatedAt=performance.now();h.frames++;h.fps=28+i%3;h.gesture='open';h.trackingState='READY';
        const world=pts.map(p=>({...p,x:0}));
        h.primary={id:0,handedness:'Right',screen:pts,raw:pts,world,ndc:{x:x*2-1,y:1-y*2},view:{x,y},palm:.16,pinch:.1,pinched:false,fingers:{count:5,extended:{thumb:true,index:true,middle:true,ring:true,pinky:true},ratio:{}}};h.hands=[h.primary];
        if(two){
          const secondary=pts.map(p=>({x:p.x+.27,y:p.y+.08,z:p.z}));
          h.hands.push({...h.primary,id:1,handedness:'Left',screen:secondary,raw:secondary,view:{x:x+.27,y:y+.08},ndc:{x:(x+.27)*2-1,y:1-(y+.08)*2}});
        }
      },33);
    },mode==='synthetic-two-hands');
    await page.waitForTimeout(1500);
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
    const before=await cdp.send('Performance.getMetrics');
    await page.evaluate(()=>{window.__spatial.metrics.reset();window.__commits={};window.__measure=true;window.__layoutReads=0;const read=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){window.__layoutReads++;return read.call(this);};window.__longTasks=[];window.__longObserver=new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration)));window.__longObserver.observe({type:'longtask'});window.__captureCount=0;const capture=window.createImageBitmap;window.createImageBitmap=(...args)=>{window.__captureCount++;return capture(...args);};});
    await page.waitForTimeout(6000);
    const after=await cdp.send('Performance.getMetrics');
    const detail=await page.evaluate(()=>{
      window.__measure=false;const {gl}=window.__three,ctx=gl.getContext(),ext=ctx.getExtension('WEBGL_debug_renderer_info');return {metrics:window.__spatial.metrics.snapshot(),commits:window.__commits,layoutReads:window.__layoutReads,captures:window.__captureCount,longTasks:window.__longTasks,gpu:ext?ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL):ctx.getParameter(ctx.RENDERER),backend:window.__spatial.handState.inferenceBackend,dpr:gl.getPixelRatio(),drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,camera:window.__spatial.handState.cameraInfo};
    });
    const metric=(v,name)=>v.metrics.find(m=>m.name===name)?.value??0;
    const row={mode,...detail,mainThreadTaskSeconds:metric(after,'TaskDuration')-metric(before,'TaskDuration'),scriptSeconds:metric(after,'ScriptDuration')-metric(before,'ScriptDuration'),errors};results.push(row);
    console.log(JSON.stringify({mode,fps:detail.metrics.render.fps,p95:detail.metrics.render.p95,detectP95:detail.metrics.detect.p95,detectFps:detail.metrics.detectFps,mainThreadTaskSeconds:row.mainThreadTaskSeconds,panelCommits:detail.commits.AssemblyPanel??0,captures:detail.captures,gpu:detail.gpu,backend:detail.backend,dpr:detail.dpr,errors}));
    await context.close();
  }
}finally{await browser.close();writeFileSync(`test-artifacts/performance/${process.env.PERF_LABEL||'latest'}.json`,JSON.stringify({date:new Date().toISOString(),note:'Isolated Chrome; fake camera has no real hand. Synthetic hand measures UI and rendering only. Not a real-user FPS certification.',results},null,2));}
