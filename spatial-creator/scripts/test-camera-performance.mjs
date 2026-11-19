import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
const pw=await import(pathToFileURL(process.env.PW_PATH||'D:/npm-global/node_modules/playwright/index.js').href);
const browser=await (pw.chromium||pw.default.chromium).launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--enable-unsafe-swiftshader']});
const results=[],errors=[];mkdirSync('test-artifacts/performance',{recursive:true});
async function test(name,fn){try{const detail=await fn();results.push({name,status:'PASS',detail});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL',name,e.message);}}
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.__slowWorker={captures:0,frames:0,results:0,init:null,messages:[],pending:0,maxPending:0};
    const capture=window.createImageBitmap;window.createImageBitmap=(...args)=>{window.__slowWorker.captures++;return capture(...args);};
    window.Worker=class extends EventTarget{
      constructor(url,options){super();if(!String(url).includes('handWorker'))return new NativeWorker(url,options);this.onmessage=null;}
      postMessage(m){const stats=window.__slowWorker;if(m.type==='init'){stats.init=m;setTimeout(()=>this.onmessage?.({data:{type:'ready',backend:'CPU'}}),0);return;}
        if(m.type==='frame'){stats.frames++;stats.messages.push({ts:m.ts,generation:m.generation});stats.pending++;stats.maxPending=Math.max(stats.maxPending,stats.pending);m.bitmap.close();setTimeout(()=>{stats.pending--;stats.results++;this.onmessage?.({data:{type:'result',ts:m.ts,generation:m.generation,doneAt:performance.now(),ms:140,hands:stats.hands||[]}});},140);}
      }
      terminate(){}
    };
  });
  await page.goto(process.env.BASE||'http://127.0.0.1:5173',{waitUntil:'networkidle'});await page.getByRole('button',{name:'鼠标模式',exact:true}).click();await page.waitForFunction(()=>window.__spatial&&window.__three);
  await test('P-CAPTURE slow inference keeps at most one capture or inference in flight',async()=>{
    await page.locator('.cam-panel').getByRole('button',{name:'启用摄像头',exact:true}).click();await page.waitForFunction(()=>window.__slowWorker.results>=6);
    const r=await page.evaluate(()=>({...window.__slowWorker,reportedFrames:window.__spatial.handState.frames,backend:window.__spatial.handState.inferenceBackend}));assert.equal(r.init.delegate,'GPU');assert.equal(r.init.auto,true);assert.equal(r.backend,'CPU');assert.equal(r.maxPending,1);assert.ok(r.captures<=r.results+1);assert.ok(r.reportedFrames>=6);return {captures:r.captures,results:r.results,maxPending:r.maxPending,requested:r.init.delegate,backend:r.backend};
  });
  await test('camera mode offers direct drawing and keeps mouse input available',async()=>{
    const start=page.getByRole('region',{name:'创作起步'});
    await start.getByRole('button',{name:'开始绘制',exact:true}).click();
    await start.getByRole('heading',{name:'绘制已就绪'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__spatial.useApp.getState().gestureMenu),null);
    const canvas=await page.locator('.viewport canvas').boundingBox();
    const x=canvas.x+canvas.width*.46,y=canvas.y+canvas.height*.45;
    await page.mouse.move(x,y);await page.mouse.down();
    try {
      await page.waitForFunction(()=>window.__spatial.drawRuntime.active);
      await page.mouse.move(x+120,y+40,{steps:14});
      await page.waitForFunction(()=>window.__spatial.drawRuntime.points.length>1);
    } finally { await page.mouse.up(); }
    await page.waitForFunction(()=>window.__spatial.useApp.getState().objects.some(o=>o.kind==='stroke'));
    await page.keyboard.press('1');
    await start.getByRole('button',{name:'开始绘制',exact:true}).waitFor();
  });
  await test('P-TRACK steady slow results preserve hand input between frames and show five fingers', async()=>{
    await page.evaluate(()=>{
      const points=new Float32Array(63);
      const set=(i,x,y)=>{points[i*3]=x;points[i*3+1]=y;};
      set(0,.50,.60);set(2,.44,.56);set(3,.40,.55);set(4,.36,.55);
      for(const [j,x,y] of [[5,.46,.50],[9,.50,.49],[13,.54,.50],[17,.57,.51]]) {
        set(j,x,y);set(j+1,x,y-.035);set(j+2,x,y-.060);set(j+3,x,y-.09);
      }
      window.__slowWorker.hands=[{pts:points,world:points,label:'Right'}];
    });
    await page.waitForFunction(()=>window.__spatial.handState.primary?.fingers.extended.ring);
    await page.locator('.finger-readout [aria-label="小指：伸展"]').waitFor();
    const sample=await page.evaluate(()=>new Promise(resolve=>{
      const {handState,pointerRuntime}=window.__spatial;
      const until=performance.now()+750;
      const samples=[];
      function tick(){
        const age=performance.now()-handState.updatedAt;
        if(age>=125&&age<220) samples.push({active:pointerRuntime.source==='hand',visible:window.__three.scene.getObjectByName('hand-rig').visible});
        if(performance.now()<until) requestAnimationFrame(tick);
        else resolve({samples,interval:handState.resultIntervalMs});
      }
      requestAnimationFrame(tick);
    }));
    await page.evaluate(()=>{window.__slowWorker.hands=[];});
    assert.ok(sample.samples.length>0,'never measured between slow results');
    assert.ok(sample.samples.every(x=>x.active&&x.visible),JSON.stringify(sample));
    return {samples:sample.samples.length,resultIntervalMs:Math.round(sample.interval)};
  });
  await test('P-PAUSE Space pauses inference and resumes with fresh timestamps',async()=>{
    await page.locator('canvas').first().click({position:{x:650,y:200}});await page.keyboard.press('Space');await page.waitForTimeout(250);const before=await page.evaluate(()=>({captures:window.__slowWorker.captures,frames:window.__spatial.handState.frames}));await page.waitForTimeout(500);assert.deepEqual(await page.evaluate(()=>({captures:window.__slowWorker.captures,frames:window.__spatial.handState.frames})),before);await page.keyboard.press('Space');await page.waitForFunction(n=>window.__spatial.handState.frames>n,before.frames);return {pausedCaptureCount:before.captures,resumed:true};
  });
  await test('P-BACKGROUND hidden page suspends frame capture and ignores delayed inference',async()=>{
    await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));await page.waitForTimeout(250);const before=await page.evaluate(()=>({captures:window.__slowWorker.captures,frames:window.__spatial.handState.frames}));await page.waitForTimeout(400);assert.deepEqual(await page.evaluate(()=>({captures:window.__slowWorker.captures,frames:window.__spatial.handState.frames})),before);await page.evaluate(()=>delete document.hidden);await page.waitForFunction(n=>window.__spatial.handState.frames>n,before.frames);return {hiddenCaptureCount:before.captures,resumed:true};
  });
  await test('P-STOP delayed worker result cannot restore a stopped camera session',async()=>{
    await page.waitForFunction(()=>window.__slowWorker.pending===1);await page.locator('.cam-panel').getByRole('button',{name:'关闭',exact:true}).click();const count=await page.evaluate(()=>window.__spatial.handState.frames);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.__spatial.handState.frames),count);assert.equal(await page.evaluate(()=>window.__spatial.handState.primary),null);return {staleResultIgnored:true};
  });
  await test('P-RESTART new camera session uses increasing capture timestamps and generation',async()=>{
    const last=await page.evaluate(()=>window.__slowWorker.messages.at(-1));await page.locator('.cam-panel').getByRole('button',{name:'启用摄像头',exact:true}).click();await page.waitForFunction(g=>window.__slowWorker.messages.some(m=>m.generation>g),last.generation);await page.waitForTimeout(400);const values=await page.evaluate(()=>window.__slowWorker.messages);assert.ok(values.at(-1).generation>last.generation);for(let i=1;i<values.length;i++)assert.ok(values[i].ts>values[i-1].ts);await page.locator('.cam-panel').getByRole('button',{name:'关闭',exact:true}).click();return {generation:values.at(-1).generation};
  });
  await test('P-HAND batched virtual hand renders complete finite pose in perspective and orthographic',async()=>{
    await page.getByRole('button',{name:'立方体',exact:true}).click();
    await page.evaluate(()=>{const h=window.__spatial.handState;window.__poseTimer=setInterval(()=>{const points=Array.from({length:21},(_,i)=>({x:.4+(i%4)*.025,y:.3+Math.floor(i/4)*.03,z:0}));h.status='ready';h.paused=false;h.updatedAt=performance.now();h.frames++;h.primary={id:0,handedness:'Right',screen:points,raw:points,world:points,palm:.16,pinch:.1,pinched:false,view:{x:.4,y:.3},ndc:{x:-.2,y:.4},fingers:{count:5,extended:{thumb:true,index:true,middle:true,ring:true,pinky:true},ratio:{}}};h.hands=[h.primary];},33);});
    for(const mode of ['perspective','orthographic']){await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('aether:view',{detail})),mode);await page.waitForTimeout(250);const r=await page.evaluate(()=>{const group=window.__three.scene.getObjectByName('hand-rig');return {visible:group.visible,instances:group.children.filter(c=>c.isInstancedMesh).map(m=>({count:m.count,finite:Array.from(m.instanceMatrix.array).every(Number.isFinite)})),calls:window.__three.gl.info.render.calls};});assert.equal(r.visible,true);assert.deepEqual(r.instances.map(m=>m.count),[21,23,5]);assert.ok(r.instances.every(m=>m.finite));assert.ok(r.calls<=20,`too many draw calls: ${r.calls}`);}
    await page.screenshot({path:'test-artifacts/performance/batched-hand.png'});await page.evaluate(()=>{clearInterval(window.__poseTimer);window.__spatial.handState.primary=null;window.__spatial.handState.hands=[];});return {instances:49,handBatches:4,projections:2};
  });
  await test('P-RUNTIME no browser exceptions',()=>{assert.deepEqual(errors,[]);return {errors:0};});
}finally{await browser.close();writeFileSync('test-artifacts/performance/regression.json',JSON.stringify({date:new Date().toISOString(),results,errors},null,2));}
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
