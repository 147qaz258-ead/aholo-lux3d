import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
const pw=await import(pathToFileURL(process.env.PW_PATH||'D:/npm-global/node_modules/playwright/index.js').href);
const browser=await (pw.chromium||pw.default.chromium).launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
const page=await context.newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
mkdirSync('test-artifacts/expansion',{recursive:true});
async function test(name,fn){try{const detail=await fn();results.push({name,status:'PASS',detail});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL',name,e.message);}}
try{
  await page.goto(process.env.BASE||'http://127.0.0.1:5173',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'鼠标模式',exact:true}).click();
  await page.waitForFunction(()=>window.__spatial?.useApp&&window.__three);
  await page.evaluate(async()=>{
    const {makeObject}=await import('/src/store.ts');
    window.__exp={s:()=>window.__spatial.useApp.getState(),check:(v,m)=>{if(!v)throw Error(m);},
      reset:()=>window.__spatial.useApp.setState({objects:[],tasks:[],assets:[],connectors:[],relations:[],assemblies:[],selectedId:null,selectedIds:[],past:[],future:[],interaction:'Idle'}),
      make:(name,x=0)=>makeObject('primitive',name,{primitive:{type:'box',params:{}},transform:{position:[x,1,0],rotation:[0,0,0],scale:[1,1,1]}})};
  });
  await test('E-SELECT 100 objects / 10 selected / atomic transform and history',()=>page.evaluate(()=>{
    const {s,check,reset,make}=window.__exp;reset();for(let i=0;i<100;i++)s().addObject(make(`零件${i}`,i));
    const ids=s().objects.slice(0,10).map(o=>o.id);s().selectMany(ids);const before=structuredClone(s().objects),steps=s().past.length;
    s().transformSelected([.2,.3,.4],[0,.25,0],1.2);check(s().selectedIds.length===10,'selection count');
    check(JSON.stringify(s().objects.slice(10))===JSON.stringify(before.slice(10)),'unselected changed');
    const distance=(a,b)=>Math.hypot(...a.transform.position.map((v,i)=>v-b.transform.position[i]));
    check(Math.abs(distance(s().objects[0],s().objects[9])-distance(before[0],before[9])*1.2)<1e-8,'relative positions');
    check(s().past.length===Math.min(50,steps+1),'one step');s().undo();check(JSON.stringify(s().objects)===JSON.stringify(before),'atomic undo');s().redo();
    return {objects:100,selected:10,relativeErrorBelow:1e-8};
  }));
  await test('E-HIERARCHY selection deduplicates descendants, locked descendant, delete preserves child',()=>page.evaluate(()=>{
    const {s,check,reset,make}=window.__exp;reset();const a=make('父'),b=make('子',1),c=make('旁',3);s().addObject(a);s().addObject(b);s().addObject(c);s().reparent(b.id,a.id);s().selectMany([a.id,b.id]);
    const before=structuredClone(s().objects);s().transformSelected([.5,0,0]);check(s().objects.every((o,i)=>i===2||Math.abs(o.transform.position[0]-before[i].transform.position[0]-.5)<1e-9),'double transformation');
    s().patchObject(b.id,{locked:true});const locked=JSON.stringify(s().objects);let refused=false;try{s().transformSelected([1,0,0]);}catch{refused=true;}check(refused&&JSON.stringify(s().objects)===locked,'locked descendant');
    s().patchObject(b.id,{locked:false});s().select(a.id);const child=structuredClone(s().objects[1]);s().removeSelected();check(s().objects.length===2&&!s().objects[0].parentId,'child kept');check(JSON.stringify(s().objects[0].transform)===JSON.stringify(child.transform),'child world changed');s().undo();check(s().objects.length===3&&s().objects[1].parentId===a.id,'delete undo');
    return {deduplicated:true,lockProtected:true,preservedChild:true};
  }));
  await test('E-VIEW six directions, orthographic/perspective and persisted camera',async()=>{
    const before=await page.evaluate(()=>JSON.stringify(window.__exp.s().objects));
    for(const [direction,axis,sign] of [['front',2,1],['back',2,-1],['left',0,-1],['right',0,1],['top',1,1],['bottom',1,-1]]){
      const v=await page.evaluate(d=>{window.dispatchEvent(new CustomEvent('aether:view',{detail:d}));return window.__exp.s().cameraView;},direction);
      const delta=v.position.map((n,i)=>n-v.target[i]);assert.ok(delta[axis]*sign>0);assert.ok(delta.every((n,i)=>i===axis||Math.abs(n)<1e-6));
    }
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether:view',{detail:'orthographic'})));
    await page.waitForFunction(()=>window.__three.camera.isOrthographicCamera);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether:view',{detail:'selected'})));
    const view=await page.evaluate(async()=>{await window.__exp.s().save();return window.__exp.s().cameraView;});assert.ok(view.orthoHeight>0);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__exp.s().objects)),before);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether:view',{detail:'perspective'})));
    await page.waitForFunction(()=>window.__three.camera.isPerspectiveCamera);
    return {directions:6,orthographicHeight:view.orthoHeight,sceneUnchanged:true};
  });
  await test('E-MATERIAL real texture, mesh parameters and GLB/native roundtrip',async()=>{
    await page.evaluate(async()=>{
      const {s,reset,make}=window.__exp;reset();const o=make('材质盒');s().addObject(o);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,2,2);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const {imageReference}=await import('/src/lib/images.ts');const texture=await imageReference(new File([blob],'red.png',{type:'image/png'}));
      s().patchObject(o.id,{material:{roughness:.8,metalness:.6,opacity:.65,emissiveIntensity:.3,texture}});
    });
    await page.waitForFunction(()=>{let m;window.__spatial.objectRegistry.get(window.__exp.s().objects[0].id)?.traverse(o=>{if(o.isMesh&&!m)m=o;});return m?.material.map&&m.material.roughness===.8;});
    return page.evaluate(async()=>{
      const {s,check}=window.__exp;const {exportSceneGlb}=await import('/src/lib/exporter.ts');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const {validateProject}=await import('/src/lib/project.ts');const {disposeObject}=await import('/src/lib/glb.ts');
      const out=await new GLTFLoader().parseAsync(await (await exportSceneGlb('material')).arrayBuffer(),'');let mat;out.scene.traverse(o=>{if(o.isMesh&&!mat)mat=o.material;});check(mat.roughness===.8&&mat.metalness===.6&&Math.abs(mat.opacity-.65)<1e-6&&mat.map,'material GLB lost');
      const snap=validateProject(JSON.parse(JSON.stringify(s().snapshot())));check(snap.objects[0].material.texture.hash.length===64,'texture metadata');let invalid=false;try{validateProject({...snap,objects:[{...snap.objects[0],material:{...snap.objects[0].material,roughness:2}}]});}catch{invalid=true;}check(invalid,'invalid material accepted');disposeObject(out.scene);return {textureHash:snap.objects[0].material.texture.hash,materialRoundtrip:true};
    });
  });
  await test('E-VERSIONS named save, diff, safe restore and pre-restore checkpoint',()=>page.evaluate(async()=>{
    const {s,check}=window.__exp;const {listVersions,versionDiff}=await import('/src/lib/versions.ts');const o=s().objects[0],version=await s().saveNamedVersion('材质完成');s().patchObject(o.id,{name:'当前更改'});const revision=s().sceneRevision;
    const diff=versionDiff(s().snapshot(),version.snapshot);check(diff.changed===1,'diff count');await s().restoreVersion(version.id);check(s().objects[0].name==='材质盒'&&s().sceneRevision>revision,'restore data/revision');const versions=await listVersions(s().projectId);check(versions.some(v=>v.label.startsWith('恢复前')&&v.snapshot.objects[0].name==='当前更改'),'missing checkpoint');
    const before=JSON.stringify(s().objects);let refused=false;try{await s().restoreVersion('missing');}catch{refused=true;}check(refused&&JSON.stringify(s().objects)===before,'failed restore damaged current');return {versions:versions.length,diff,revision:s().sceneRevision};
  }));
  await test('E-JOINT 100 hinge and slider movements, limits, connector errors, undo and locks',()=>page.evaluate(async()=>{
    const {s,check,reset,make}=window.__exp;const {matrix,connectorMatrix}=await import('/src/lib/assembly.ts');const {THREE}=window.__spatial;let maxPosition=0,maxAngle=0;
    for(const type of ['hinge','slider']){
      reset();const a=make('基座'),b=make('活动件',1);s().addObject(a);s().addObject(b);s().setTransform(a.id,{rotation:[.3,.2,.1],scale:[1.2,1.2,1.2]});s().convertToPart(a.id);s().convertToPart(b.id);s().addConnector(a.id,[.3,0,0]);s().addConnector(b.id,[-.3,0,0]);const [ca,cb]=s().connectors;s().connect(ca.id,cb.id,type,{min:-.5,max:.5});const id=s().relations[0].id,zero=structuredClone(s().objects[1].transform);
      for(let i=0;i<100;i++){
        const v=Math.sin(i)*.5;s().setJointValue(id,v);const [parent,child]=s().objects,pa=matrix(parent.transform).multiply(connectorMatrix(ca)),pb=matrix(child.transform).multiply(connectorMatrix(cb));const p=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3(),p2=new THREE.Vector3(),q2=new THREE.Quaternion();pa.decompose(p,q,scale);pb.decompose(p2,q2,scale);
        const expected=type==='slider'?p.clone().addScaledVector(new THREE.Vector3(0,1,0).transformDirection(pa),v):p;const err=expected.distanceTo(p2),angle=Math.abs(q.angleTo(q2)-(type==='hinge'?Math.abs(v):0));maxPosition=Math.max(maxPosition,err);maxAngle=Math.max(maxAngle,angle);check(err<1e-7&&angle<1e-6,`${type} independent connector error ${err}/${angle}`);
      }
      s().setJointValue(id,9);check(s().relations[0].limits.value===.5,'upper limit');s().undo();check(s().relations[0].limits.value!==.5,'joint undo');s().setJointValue(id,0);check(matrix(s().objects[1].transform).elements.every((v,i)=>Math.abs(v-matrix(zero).elements[i])<1e-7),'neutral drift');
      s().patchObject(b.id,{locked:true});const before=JSON.stringify(s().objects);let refused=false;try{s().setJointValue(id,.2);}catch{refused=true;}check(refused&&before===JSON.stringify(s().objects),'locked joint');s().patchObject(b.id,{locked:false});
      if(type==='slider'){
        const {connectionError}=await import('/src/lib/assembly.ts');s().setJointValue(id,.2);
        const validate=()=>{const r=s().relations[0],err=connectionError(s().objects,s().connectors,r);check(err.position<1e-7&&err.angle<1e-5,'scaled slider constraint drift');};
        s().transformAssembly(s().assemblies[0].id,{position:[.1,.2,0],rotation:[0,.3,0],scale:[1.5,1.5,1.5]});check(Math.abs(s().relations[0].limits.value-.3)<1e-8,'slider value did not scale');validate();
        s().select(a.id);s().setTransform(a.id,{scale:[2.7,2.7,2.7]});validate();s().selectMany([a.id,b.id]);s().transformSelected([.1,0,0],[0,.2,0],1.2);validate();
      }
    }await s().save();return {movements:200,maxPosition,maxAngle};
  }));
  await test('E-MULTI-CONNECT valid fixed pair, conflict rejection and detach remaining relation',()=>page.evaluate(()=>{
    const {s,check,reset,make}=window.__exp;reset();const a=make('A'),b=make('B',1);s().addObject(a);s().addObject(b);s().convertToPart(a.id);s().convertToPart(b.id);
    for(const id of [a.id,b.id]){s().addConnector(id,[0,0,0]);s().addConnector(id,[.2,0,0]);s().addConnector(id,[id===a.id?.4:.8,0,0]);}
    const c=s().connectors;s().connect(c[0].id,c[3].id);s().connect(c[1].id,c[4].id);check(s().relations.length===2,'second fixed');const before=JSON.stringify(s().objects);let refused=false;try{s().connect(c[2].id,c[5].id);}catch{refused=true;}check(refused&&before===JSON.stringify(s().objects),'contradiction not atomic');s().detach(s().relations[0].id);check(s().objects[1].parentId===a.id,'remaining relation lost parent');return {validConnections:2,conflictRejected:true};
  }));
  await test('E-INTERCHANGE OBJ/STL import, scoped export, no decoration meshes and invalid rejection',async()=>{
    await page.evaluate(()=>{const {s,reset,make}=window.__exp;reset();s().addObject(make('导出盒'));s().addObject(make('不导出',10));});await page.waitForTimeout(300);
    return page.evaluate(async()=>{
      const {s,check}=window.__exp;const {importGeometry}=await import('/src/lib/interchange.ts');const {exportSceneFormat}=await import('/src/lib/exporter.ts');const {parseGlb,disposeObject}=await import('/src/lib/glb.ts');const {STLLoader}=await import('/node_modules/three/examples/jsm/loaders/STLLoader.js');const {OBJLoader}=await import('/node_modules/three/examples/jsm/loaders/OBJLoader.js');const {THREE}=window.__spatial;
      const fixture='v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';const imported=await parseGlb(await importGeometry(new File([fixture],'triangle.obj')));let vertices=0;imported.traverse(o=>{if(o.isMesh)vertices+=o.geometry.attributes.position.count;});check(vertices===3,'OBJ triangle');disposeObject(imported);
      const ids=[s().objects[0].id],obj=await exportSceneFormat('obj','selected',ids),stl=await exportSceneFormat('stl','selected',ids);const objRoot=new OBJLoader().parse(await obj.text()),box=new THREE.Box3().setFromObject(objRoot);check(box.max.x<1&&box.min.x> -1,'exported unselected object');
      const geometry=new STLLoader().parse(await stl.arrayBuffer());geometry.computeBoundingBox();check(Math.abs(geometry.boundingBox.max.x-.3)<1e-6,'STL bounds');const roundtrip=await parseGlb(await importGeometry(new File([stl],'export.stl')));disposeObject(roundtrip);disposeObject(objRoot);geometry.dispose();
      let invalid=false;try{await importGeometry(new File(['garbage'],'empty.obj'));}catch{invalid=true;}check(invalid,'invalid accepted');return {fixtureVertices:vertices,objBytes:obj.size,stlBytes:stl.size,scopeCorrect:true};
    });
  });
  await test('E-COMMAND target binding, multiround, preview isolation, conflict and unsupported grammar',()=>page.evaluate(async()=>{
    const {s,check}=window.__exp;const {planSceneCommand}=await import('/src/lib/sceneCommands.ts');const target=s().objects[0];s().select(target.id);const before=JSON.stringify(s().objects),t=planSceneCommand('把它缩小10%');s().addTask(t);check(JSON.stringify(s().objects)===before,'preview mutated');check(s().acceptTask(t.id),'accept');check(Math.abs(s().objects[0].transform.scale[0]-.9)<1e-8,'scale');check(!s().acceptTask(t.id),'duplicate accept');
    s().select(s().objects[1].id);const next=planSceneCommand('把刚才那个改为蓝色');check(next.targetObjectId===target.id&&next.parentTaskId===t.id,'multiround wrong target');s().addTask(next);s().acceptTask(next.id);check(s().objects[0].color==='#8fb4ff'&&s().objects[1].color!==s().objects[0].color,'target isolation');
    const conflict=planSceneCommand('把「导出盒」向右移动0.2');s().addTask(conflict);s().patchObject(target.id,{name:'改名'});const changed=JSON.stringify(s().objects);check(!s().acceptTask(conflict.id)&&JSON.stringify(s().objects)===changed,'stale write');
    for(const prompt of ['删除它然后缩小10%','把它缩小10%然后移动其他对象','随便生成房子']){let refused=false;try{planSceneCommand(prompt);}catch{refused=true;}check(refused,`unsupported accepted ${prompt}`);}
    const explain=planSceneCommand('解释场景');check(explain.explanation.includes('2 个对象')&&JSON.stringify(s().objects)===changed,'explanation changed scene');s().patchObject(s().objects[1].id,{name:'改名'});let ambiguous=false;try{planSceneCommand('把「改名」缩小10%');}catch{ambiguous=true;}check(ambiguous,'ambiguous name accepted');
    return {multiround:true,unsupportedRejected:3,staleBlocked:true};
  }));
  await test('E-REGION preview geometry isolation, boundary, acceptance and undo',async()=>{
    await page.waitForTimeout(250);
    const detail=await page.evaluate(async()=>{
      const {s,check}=window.__exp;const {regionCandidate}=await import('/src/lib/regionEdit.ts');const {localTask}=await import('/src/lib/sceneCommands.ts');const target=s().objects[0],root=window.__spatial.objectRegistry.get(target.id);let mesh;root.traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});const before=Array.from(mesh.geometry.attributes.position.array),center=[.3,.3,.3],radius=.2,delta=[0,-.02,0],candidate=regionCandidate(target,center,radius,delta);
      check(JSON.stringify(before)===JSON.stringify(Array.from(mesh.geometry.attributes.position.array)),'preview wrote runtime');const edits=candidate.geometryEdits['0'];let changed=0;for(let i=0;i<before.length;i+=3){const distance=Math.hypot(...before.slice(i,i+3).map((n,k)=>n-center[k]));const different=before.slice(i,i+3).some((n,k)=>Math.abs(n-edits[i+k])>1e-9);if(distance>=radius)check(!different,'outside radius modified');if(different)changed++;}check(changed>0,'no region effect');
      const task=localTask(target,candidate,'区域测试','region');s().addTask(task);check(s().acceptTask(task.id),'region accept');window.__regionCheck={id:target.id,before,after:edits};return {changedVertices:changed};
    });
    await page.waitForFunction(()=>{const t=window.__regionCheck;let mesh;window.__spatial.objectRegistry.get(t.id).traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});return mesh.geometry.attributes.position.array.every((v,i)=>Math.abs(v-t.after[i])<1e-7);});
    await page.evaluate(()=>window.__exp.s().undo());await page.waitForFunction(()=>{const t=window.__regionCheck;let mesh;window.__spatial.objectRegistry.get(t.id).traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});return mesh.geometry.attributes.position.array.every((v,i)=>Math.abs(v-t.before[i])<1e-7);});return detail;
  });
  await test('E-UI preview comparison renders, fits geometry, and confirmation writes target',async()=>{
    await page.evaluate(async()=>{const {previewCopy}=await import('/src/ui/ObjectComparison.tsx');const {fitPreview}=await import('/src/ui/PreviewCanvas.tsx');const {THREE}=window.__spatial,{check,s}=window.__exp;const root=previewCopy(s().objects[0].id);let mesh;root.traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});check(!Array.isArray(mesh.material),'single material became array: grouped box faces would disappear');const camera=new THREE.PerspectiveCamera(45,1,.01,100);fitPreview(camera,root,466,320);const box=new THREE.Box3().setFromObject(root);for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);check(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1&&p.z> -1,'preview clips geometry');}const {disposeObject}=await import('/src/lib/glb.ts');disposeObject(root);});
    await page.evaluate(()=>{const s=window.__exp.s();s.patchObject(s.objects[0].id,{name:'交互目标'});s.patchObject(s.objects[1].id,{name:'第二对象'});s.select(s.objects[0].id);});
    const input=page.getByRole('textbox',{name:'本地场景指令'});await input.fill('把它改为绿色');await page.getByRole('button',{name:'解析并预览指令'}).click();const modal=page.getByRole('dialog',{name:'场景修改确认'});await modal.waitFor();await modal.getByRole('button',{name:'确认修改目标'}).waitFor();await page.waitForTimeout(1000);assert.equal(await modal.locator('canvas').count(),2);assert.equal(await modal.getByRole('button',{name:'确认修改目标'}).isEnabled(),true);await page.screenshot({path:'test-artifacts/expansion/comparison.png'});await modal.getByRole('button',{name:'确认修改目标'}).click();
    await page.screenshot({path:'test-artifacts/expansion/workspace.png'});return {comparisonCanvases:2};
  });
  await test('E-UI-MULTI Ctrl/Shift list selection and atomic batch-delete confirmation',async()=>{
    const items=page.locator('.obj-item');await items.nth(0).click();await items.nth(1).click({modifiers:['Control']});assert.equal(await page.evaluate(()=>window.__exp.s().selectedIds.length),2);assert.equal(await page.locator('.obj-item[aria-pressed=true]').count(),2);
    await page.getByRole('button',{name:'删除选中 2 个',exact:true}).click();const modal=page.getByRole('dialog',{name:'确认批量删除'});await modal.waitFor();assert.match(await modal.innerText(),/删除 2 个对象/);await modal.getByRole('button',{name:'确认删除',exact:true}).click();assert.equal(await items.count(),0);await page.evaluate(()=>window.__exp.s().undo());assert.equal(await items.count(),2);
    await items.nth(0).click();await items.nth(1).click({modifiers:['Shift']});assert.equal(await page.evaluate(()=>window.__exp.s().selectedIds.length),2);return {modifierSelections:2,atomicUndo:true};
  });
  await test('E-REFERENCE image hash, purpose and task lineage persist with mocked rejection',async()=>{
    await page.getByRole('button',{name:'生成',exact:true}).click();
    await page.route('**/api/lux3d/img-to-3d',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'local reference test; no upstream request'})}));
    const imageData=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=2;return c.toDataURL('image/png').split(',')[1];});
    await page.locator('.ai-panel input[type=file]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(imageData,'base64')});
    await page.getByRole('combobox',{name:'参考图用途'}).selectOption('material');await page.getByRole('button',{name:'图生 3D（需鼠标选图）',exact:true}).click();await page.waitForFunction(()=>window.__exp.s().tasks.some(t=>t.references?.length&&t.state==='failed'));
    return page.evaluate(async()=>{const {s,check}=window.__exp;const t=s().tasks.find(t=>t.references?.length);check(t.references[0].purpose==='material'&&t.references[0].hash.length===64,'reference metadata');const {validateProject}=await import('/src/lib/project.ts');const p=validateProject(JSON.parse(JSON.stringify(s().snapshot())));check(p.tasks.find(x=>x.id===t.id).references[0].dataUrl===t.references[0].dataUrl,'reference persistence');return {purpose:t.references[0].purpose,hashLength:t.references[0].hash.length,upstreamRequests:0};});
  });
  await test('E-PERSIST material, selection reset, versions and pending commands after reload',async()=>{
    const before=await page.evaluate(async()=>{const {s}=window.__exp;await s().save();return {objects:s().objects,relations:s().relations,projectId:s().projectId};});await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'鼠标模式',exact:true}).click();await page.waitForFunction(()=>window.__spatial?.useApp?.getState().booted);
    const after=await page.evaluate(async()=>{const s=window.__spatial.useApp.getState();const {listVersions}=await import('/src/lib/versions.ts');return {objects:s.objects,relations:s.relations,projectId:s.projectId,selection:s.selectedIds,versions:(await listVersions(s.projectId)).length};});assert.deepEqual(after.objects,before.objects);assert.deepEqual(after.relations,before.relations);assert.equal(after.projectId,before.projectId);assert.deepEqual(after.selection,[]);assert.ok(after.versions>=2);return {versions:after.versions};
  });
  await test('E-RUNTIME no browser exceptions',()=>{assert.deepEqual(errors,[]);return {errors:0};});
}finally{writeFileSync('test-artifacts/expansion/results.json',JSON.stringify({date:new Date().toISOString(),results,errors},null,2));await browser.close();}
console.log(`${results.filter(r=>r.status==='PASS').length}/${results.length} groups passed`);if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
