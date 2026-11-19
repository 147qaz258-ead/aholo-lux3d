import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const pw = await import(pathToFileURL(process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js").href);
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const results = [];
mkdirSync("test-artifacts/draft1", { recursive: true });
async function test(name, fn) {
  try { const detail = await fn(); results.push({ name, status: "PASS", detail }); console.log("PASS", name); }
  catch (e) { results.push({ name, status: "FAIL", error: e.message }); console.error("FAIL", name, e.message); }
}
try {
  await page.goto(process.env.BASE || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "鼠标模式", exact: true }).click();
  await page.waitForFunction(() => window.__spatial?.useApp && window.__three);
  await test("T-HISTORY-001 object CRUD, transforms, locks, undo and redo", async () => {
    return page.evaluate(async () => {
      const { useApp: store } = window.__spatial, s = () => store.getState();
      const { makeObject } = await import("/src/store.ts");
      const a = makeObject("primitive", "主体", { primitive: { type: "box", params: {} } });
      const b = makeObject("primitive", "部件", { primitive: { type: "sphere", params: {} }, transform: { position: [1, 0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
      s().addObject(a); s().addObject(b);
      const check = (v, m) => { if (!v) throw Error(m); };
      s().setTransform(a.id, { position: [0.2, 0.6, 0] }); check(s().objects[0].transform.position[0] === 0.2, "move");
      check(s().undo(), "undo move"); check(s().objects[0].transform.position[0] === 0, "undo transform");
      check(s().redo(), "redo move"); check(s().objects[0].transform.position[0] === 0.2, "redo transform");
      s().patchObject(a.id, { locked: true }); s().setTransform(a.id, { position: [99, 99, 99] }); s().removeObject(a.id);
      check(s().objects.length === 2 && s().objects[0].transform.position[0] === 0.2, "locked protection");
      s().patchObject(a.id, { locked: false }); s().duplicateObject(a.id); check(s().objects.length === 3, "duplicate");
      s().removeObject(s().selectedId); check(s().objects.length === 2, "delete");
      s().undo(); check(s().objects.length === 3, "undo delete"); s().undo(); check(s().objects.length === 2, "undo duplicate");
      s().setTransform(a.id, { scale: [0, 1, 1] }); check(s().objects[0].transform.scale[0] === 1, "invalid scale rejected");
      return { ids: s().objects.map(o => o.id), assertions: 12 };
    });
  });
  await test("T-ASM-001/002/003 fixed alignment, hierarchy, assembly transform and cycles", async () => {
    return page.evaluate(async () => {
      const store = window.__spatial.useApp, s = () => store.getState(); const check = (v, m) => { if (!v) throw Error(m); };
      const { matrix, connectorMatrix } = await import("/src/lib/assembly.ts");
      const [a, b] = s().objects; s().convertToPart(a.id); s().convertToPart(b.id);
      s().addConnector(a.id, [0.3, 0, 0], [0, 0, Math.PI / 2]); s().addConnector(b.id, [-0.3, 0, 0]);
      const [ca, cb] = s().connectors; s().connect(ca.id, cb.id);
      const aligned = () => {
        const [a, b] = s().objects;
        const ma = matrix(a.transform).multiply(connectorMatrix(ca)); const mb = matrix(b.transform).multiply(connectorMatrix(cb));
        const diff = Math.max(...ma.elements.map((v, i) => Math.abs(v - mb.elements[i])));
        check(diff < 1e-5, `connector error ${diff}`); return diff;
      };
      aligned(); check(s().assemblies.length === 1 && s().relations[0].status === "valid", "assembly creation");
      s().reparent(a.id, b.id); check(!s().objects[0].parentId, "cycle rejected");
      const local = JSON.stringify(s().objects[1].localTransform);
      for (let i = 0; i < 100; i++) { const g = s().assemblies[0]; s().transformAssembly(g.id, { position: [i * 0.01, 0.2, 0], rotation: [0, i * 0.01, 0], scale: [1.1, 1.1, 1.1] }); }
      const diff = aligned(); check(JSON.stringify(s().objects[1].localTransform) === local, "local coordinates stable");
      const prior = JSON.stringify(s().objects); s().undo(); s().redo(); check(JSON.stringify(s().objects) === prior, "whole assembly undo redo");
      return { repetitions: 100, maxMatrixError: diff };
    });
  });
  await test("T-ASM-004/005 child edit flags broken relation, detach preserves parts", async () => {
    return page.evaluate(() => {
      const s = () => window.__spatial.useApp.getState(); const b = s().objects[1]; const aBefore = JSON.stringify(s().objects[0]);
      s().setTransform(b.id, { position: [2, 1, 0] }); if (s().relations[0].status !== "broken") throw Error("missing broken relation");
      if (JSON.stringify(s().objects[0]) !== aBefore) throw Error("unrelated parent changed");
      s().detach(s().relations[0].id); if (s().objects.length !== 2 || s().objects[1].parentId) throw Error("detach lost part");
      s().undo(); s().undo(); return { retainedParts: s().objects.length };
    });
  });
  await test("T-ASM-LOCK locked descendants block parent transforms and whole assembly changes", async () => {
    return page.evaluate(() => {
      const s=()=>window.__spatial.useApp.getState(), [parent,child]=s().objects;
      const initial=JSON.stringify(s().objects);s().setTransform(parent.id,{scale:[2,1,1]});
      if(JSON.stringify(s().objects)!==initial)throw Error("hierarchy accepted nonuniform scale that could shear children");
      s().patchObject(child.id,{locked:true}); const before=JSON.stringify(s().objects), history=s().past.length;
      s().setTransform(parent.id,{position:[9,9,9]});
      let refused=false;try{s().transformAssembly(s().assemblies[0].id,{position:[1,1,1],rotation:[0,0,0],scale:[1,1,1]});}catch{refused=true;}
      if(!refused||JSON.stringify(s().objects)!==before||s().past.length!==history)throw Error("locked child moved through ancestor");
      s().patchObject(child.id,{visible:false});if(s().objects[1].visible)throw Error("locked object visibility did not update");
      s().undo();s().undo();return {parentTransformBlocked:true,assemblyTransformBlocked:true};
    });
  });
  await test("T-SCULPT-001 absolute deformation, radius isolation and vertex persistence", async () => {
    await page.waitForTimeout(500);
    return page.evaluate(async () => {
      const { THREE, objectRegistry, useApp } = window.__spatial;
      const { beginSculptOp, sculptFromBaseline, endSculptOp, captureGeometry } = await import("/src/lib/deformation.ts");
      const target = useApp.getState().objects[0], root = objectRegistry.get(target.id);
      let mesh; root.traverse(o => { if (!mesh && o.isMesh) mesh = o; }); root.updateMatrixWorld(true);
      const position = mesh.geometry.attributes.position;
      const before = Array.from(position.array); const point = new THREE.Vector3().fromBufferAttribute(position, 0).applyMatrix4(mesh.matrixWorld);
      beginSculptOp(mesh); sculptFromBaseline(mesh, point, 0.3, new THREE.Vector3(0, -0.02, 0));
      const first = Array.from(position.array);
      for (let i = 0; i < 60; i++) sculptFromBaseline(mesh, point, 0.3, new THREE.Vector3(0, -0.02, 0));
      if (JSON.stringify(first) !== JSON.stringify(Array.from(position.array))) throw Error("holding pressure accumulates");
      if (JSON.stringify(before) === JSON.stringify(first)) throw Error("no vertices changed");
      const far = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        far.fromArray(before, i * 3).applyMatrix4(mesh.matrixWorld);
        if (far.distanceTo(point) > 0.3 && [0,1,2].some(k => before[i*3+k] !== first[i*3+k])) throw Error("outside radius changed");
      }
      endSculptOp(); useApp.getState().patchObject(target.id, { deformed: true, geometryEdits: captureGeometry(root) });
      window.__draftGeometry = { id: target.id, values: first };
      await useApp.getState().save();
      return { vertices: position.count, staticUpdates: 60 };
    });
  });
  await test("T-DATA-001 reload restores IDs, deformations and assembly relations", async () => {
    const before = await page.evaluate(() => ({ objects: window.__spatial.useApp.getState().objects, relations: window.__spatial.useApp.getState().relations, assemblies: window.__spatial.useApp.getState().assemblies }));
    await page.reload({ waitUntil: "networkidle" }); await page.getByRole("button", { name: "鼠标模式", exact: true }).click();
    await page.waitForFunction(() => window.__spatial?.objectRegistry.size >= 2); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ objects: window.__spatial.useApp.getState().objects, relations: window.__spatial.useApp.getState().relations, assemblies: window.__spatial.useApp.getState().assemblies }));
    assert.deepEqual(after, before);
    const geometry = await page.evaluate(() => {
      const { useApp, objectRegistry } = window.__spatial; const o = useApp.getState().objects[0];
      let actual; objectRegistry.get(o.id).traverse(m => { if (!actual && m.isMesh) actual = Array.from(m.geometry.attributes.position.array); });
      return { actual, saved: o.geometryEdits["0"] };
    });
    assert.deepEqual(geometry.actual, geometry.saved); return { objects: after.objects.length, relations: after.relations.length };
  });
  await test("T-AI-002/004/005/010 preview rejection, version conflict and idempotent accept", async () => {
    return page.evaluate(async () => {
      const { useApp: store } = window.__spatial; const s = () => store.getState();
      const { makeObject } = await import("/src/store.ts");
      const add = (id, type = "CREATE_OBJECT") => {
        const target = s().objects[0]; const candidate = makeObject("primitive", "AI 预览测试", { primitive: { type: "sphere", params: {} }, source: "ai", sourceTaskId: id });
        s().addTask({ id, label: "test", mode: "text", state: "preview", progress: 1, createdAt: Date.now(), projectId: s().projectId, sceneRevision: s().sceneRevision,
          taskType: type, targetObjectId: target.id, targetObjectVersion: target.version, candidate });
      };
      const original = JSON.stringify(s().objects); add("reject"); s().rejectTask("reject");
      if (JSON.stringify(s().objects) !== original) throw Error("reject changed scene");
      add("conflict", "REPLACE_OBJECT"); s().patchObject(s().objects[0].id, { name: "修改后的主体" }); const changed = JSON.stringify(s().objects);
      if (s().acceptTask("conflict") || JSON.stringify(s().objects) !== changed) throw Error("stale overwrite");
      add("accept"); const before = JSON.stringify(s().objects), count = s().objects.length;
      for (let i = 0; i < 10; i++) s().acceptTask("accept");
      if (s().objects.length !== count + 1 || JSON.stringify(s().objects.slice(0,count)) !== before) throw Error("repeat accept or unauthorized modification");
      s().undo(); if (s().objects.length !== count) throw Error("AI accept undo");
      return { replayCount: 10, unauthorizedChanges: 0 };
    });
  });
  await test("T-DRAW-001 mouse draw, raw points, plane metadata and undo", async () => {
    await page.evaluate(() => { window.__spatial.useApp.getState().setTool("draw"); });
    await page.waitForTimeout(100);
    const prior = await page.evaluate(() => window.__spatial.useApp.getState().objects.length);
    await page.mouse.move(500, 430); await page.mouse.down();
    for (let i = 0; i < 15; i++) { await page.mouse.move(500 + i * 12, 430 + Math.sin(i / 3) * 30); await page.waitForTimeout(35); }
    await page.mouse.up(); await page.waitForTimeout(150);
    const stroke = await page.evaluate(() => window.__spatial.useApp.getState().objects.at(-1));
    assert.equal(stroke.kind, "stroke"); assert.ok(stroke.rawPoints.length >= 3); assert.ok(stroke.planeId.startsWith("camera"));
    await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__spatial.useApp.getState().objects.length), prior);
    return { rawPoints: stroke.rawPoints.length };
  });
  await test("T-INTERACT-001 Escape cancels active stroke without creating history", async () => {
    const before = await page.evaluate(() => ({ count: window.__spatial.useApp.getState().objects.length, past: window.__spatial.useApp.getState().past.length }));
    await page.mouse.move(520, 400); await page.mouse.down(); await page.mouse.move(650, 400, { steps: 8 }); await page.waitForTimeout(80);
    await page.keyboard.press("Escape"); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ count: window.__spatial.useApp.getState().objects.length, past: window.__spatial.useApp.getState().past.length }));
    assert.deepEqual(after, before);
  });
  await test("T-HAND-004 four corner validation, nine-point errors, pinch confirmation and identities", async () => {
    return page.evaluate(async () => {
      const { fourCornerCalibration, ninePointErrors } = await import("/src/lib/calibration.ts");
      const { ConfirmedPinch, HandIdentity } = await import("/src/lib/handIdentity.ts");
      const sample = (x,y) => Array.from({ length:15 }, () => ({x,y}));
      const cal = fourCornerCalibration([sample(.1,.1),sample(.9,.1),sample(.9,.9),sample(.1,.9)]);
      let rejected = false; try { fourCornerCalibration([sample(.1,.1),sample(.2,.1),sample(.2,.2),sample(.1,.2)]); } catch { rejected = true; }
      if (!rejected || !ninePointErrors(Array.from({length:9},()=>({x:0,y:0})),1600,1000).pass) throw Error("calibration validation");
      const p = new ConfirmedPinch(), states = [.8,.8,.8,.55,.3,.3,.3].map(v => p.update(v));
      if (JSON.stringify(states) !== JSON.stringify([false,false,true,true,true,true,false])) throw Error("three frame hysteresis");
      const h = new HandIdentity(); const first = h.assign([{x:.2,y:.5},{x:.8,y:.5}],0); const swapped = h.assign([{x:.79,y:.5},{x:.21,y:.5}],30);
      if (first.ids[0] !== swapped.ids[1]) throw Error("array order swapped identity");
      if (!h.assign([{x:.5,y:.5},{x:.51,y:.5}],60).uncertain) throw Error("ambiguity not gated");
      return { calibration: cal, pinchStates: states };
    });
  });
  await test("T-PROJECT-002 native file portability to an empty browser", async () => {
    await page.evaluate(() => window.__spatial.useApp.getState().setTool("select")); await page.waitForTimeout(100);
    await page.evaluate(async () => {
      const { idb } = await import("/src/lib/idb.ts"), { exportSceneGlb } = await import("/src/lib/exporter.ts"), { makeObject } = await import("/src/store.ts");
      const s = window.__spatial.useApp.getState();
      const blob = await exportSceneGlb("portable-mesh", [s.objects[0].id]);
      await idb.putAsset("portable-fixture", blob);
      s.addObject(makeObject("model", "本地 GLB 资产", { assetId: "portable-fixture", source: "import" }));
    });
    await page.waitForTimeout(500);
    const downloadEvent = page.waitForEvent("download");
    await page.evaluate(() => window.__spatial.useApp.getState().saveProjectFile());
    const download = await downloadEvent; await download.saveAs("test-artifacts/draft1/portable.aether.json");
    const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const other = await fresh.newPage(); await other.goto(page.url(), { waitUntil: "networkidle" }); await other.getByRole("button", { name: "鼠标模式", exact: true }).click();
    await other.waitForFunction(() => window.__spatial?.useApp);
    await other.getByRole("button", { name: /项目 ·/ }).click();
    await other.locator('[aria-label="项目管理"] input[type=file]').setInputFiles("test-artifacts/draft1/portable.aether.json");
    await other.waitForFunction(() => window.__spatial.useApp.getState().objects.length >= 2);
    const original = await page.evaluate(() => window.__spatial.useApp.getState().objects);
    const reopened = await other.evaluate(() => window.__spatial.useApp.getState().objects);
    const normalized = objects => JSON.parse(JSON.stringify(objects.map(o => ({ ...o, assetId: o.assetId ? "embedded" : undefined }))));
    assert.deepEqual(normalized(reopened), normalized(original));
    await other.waitForFunction(() => {
      const { useApp, objectRegistry } = window.__spatial; const o = useApp.getState().objects.find(o => o.kind === "model");
      let loaded = false; objectRegistry.get(o.id)?.traverse(c => { if (c.isMesh) loaded = true; }); return loaded;
    });
    await fresh.close();
    return { objects: original.length };
  });
  await test("T-DRAW-002 closed surface conversion rejects open and self-intersecting outlines", async () => {
    return page.evaluate(async () => {
      const { buildSurfaceGeometry, smoothStroke } = await import("/src/lib/stroke.ts");
      const valid = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,0]];
      const geometry = buildSurfaceGeometry(valid);
      if (!geometry.attributes.position.count) throw Error("empty surface"); geometry.dispose();
      for (const points of [valid.slice(0,-1), [[0,0,0],[1,1,0],[0,1,0],[1,0,0],[0,0,0]]]) {
        let rejected=false; try { buildSurfaceGeometry(points); } catch { rejected=true; } if (!rejected) throw Error("invalid contour accepted");
      }
      const smoothed = smoothStroke(valid, 1); if (JSON.stringify(smoothed[0]) !== JSON.stringify(valid[0]) || JSON.stringify(smoothed.at(-1)) !== JSON.stringify(valid.at(-1))) throw Error("endpoints drifted");
      return { contours: 3, invalidRejected: 2 };
    });
  });
  await test("T-AI-CONTEXT selected target survives context budget and actual provider prompt is bounded", async () => {
    return page.evaluate(async()=>{
      const {sceneContext,providerText}=await import("/src/lib/aiContext.ts");
      const s=window.__spatial.useApp.getState(),original=s.objects,target=s.objects.at(-1);
      try{
        window.__spatial.useApp.setState({objects:[...Array.from({length:35},(_,i)=>({...original[0],id:`budget_${i}`})),target]});
        const context=sceneContext(target.id),prompt=providerText("独立零件",context,"GENERATE_PART");
        if(context.objects[0].objectId!==target.id||context.omittedObjects!==6||!prompt.includes(target.name))throw Error("target omitted from context");
        if(providerText("a".repeat(600),context,"REPLACE_OBJECT").length>800)throw Error("provider prompt exceeds budget");
        return {contextObjects:context.objects.length,targetRetained:true};
      }finally{window.__spatial.useApp.setState({objects:original});}
    });
  });
  await test("T-IMPORT-INVALID malformed GLB vertices and indices cannot enter scene", async()=>{
    return page.evaluate(async()=>{
      const {parseGlb,disposeObject}=await import("/src/lib/glb.ts"),{exportSceneGlb}=await import("/src/lib/exporter.ts");
      const s=window.__spatial.useApp.getState(),original=JSON.stringify(s.objects);
      const valid=await (await exportSceneGlb("invalid-test",[s.objects[0].id])).arrayBuffer();
      const header=new DataView(valid),jsonLength=header.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(valid,20,jsonLength)));
      const binaryStart=20+jsonLength+8,mesh=json.meshes[0].primitives[0];
      let rejected=0;
      for(const kind of ["position","index"]){
        const copy=valid.slice(0),view=new DataView(copy),accessor=json.accessors[kind==="position"?mesh.attributes.POSITION:mesh.indices],bufferView=json.bufferViews[accessor.bufferView];
        const offset=binaryStart+(bufferView.byteOffset||0)+(accessor.byteOffset||0);
        if(kind==="position")view.setFloat32(offset,NaN,true);
        else if(accessor.componentType===5125)view.setUint32(offset,4294967295,true);
        else view.setUint16(offset,65535,true);
        try{disposeObject(await parseGlb(copy));}catch{rejected++;}
      }
      if(rejected!==2||JSON.stringify(s.objects)!==original)throw Error("malformed model accepted or scene changed");
      return {invalidModelsRejected:rejected};
    });
  });
  await test("T-ASM-006 replacing one part preserves identity and unrelated objects; undo restores it", async () => {
    return page.evaluate(() => {
      const s = () => window.__spatial.useApp.getState(), target = s().objects[0], source = s().objects.find(o=>o.kind==="model");
      const previous = JSON.stringify(target), unrelated = JSON.stringify(s().objects.slice(1));
      s().replacePart(target.id,source.id);
      const replaced=s().objects[0];
      if(replaced.id!==target.id||replaced.partId!==target.partId||replaced.assetId!==source.assetId||JSON.stringify(s().objects.slice(1))!==unrelated)throw Error("replacement scope or identity");
      if(s().relations.some(r=>r.status!=="broken"&&r.status!=="suppressed"))throw Error("replacement relations not flagged");
      s().undo(); if(JSON.stringify(s().objects[0])!==previous)throw Error("replacement undo did not restore old geometry");
      return { identityPreserved:true, unrelatedChanges:0 };
    });
  });
  await test("T-VIEW-001 frame all, frame selected and reset leave object transforms unchanged", async () => {
    const before = await page.evaluate(()=>JSON.stringify(window.__spatial.useApp.getState().objects));
    await page.evaluate(()=>window.__spatial.useApp.getState().select(window.__spatial.useApp.getState().objects[0].id));
    await page.getByRole("button",{name:"视图",exact:true}).click();
    await page.getByRole("button",{name:"聚焦选中",exact:true}).click(); await page.waitForTimeout(100);
    await page.getByRole("button",{name:"显示全部",exact:true}).click(); await page.waitForTimeout(100);
    await page.getByRole("button",{name:"复位视图",exact:true}).click(); await page.waitForTimeout(100);
    await page.getByRole("button",{name:"视图",exact:true}).click();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__spatial.useApp.getState().objects)),before);
    const view = await page.evaluate(()=>window.__spatial.useApp.getState().cameraView);
    assert.ok(Math.abs(view.position[2]-4.8)<1e-5);
  });
  await test("T-AI-001/002 local GLB adapter preview reject and accept through the UI", async () => {
    await page.getByRole("button", { name: "生成", exact: true }).click();
    const before = await page.evaluate(()=>window.__spatial.useApp.getState().objects.length);
    const prepare = async id => page.evaluate(async id => {
      const { makeObject }=await import("/src/store.ts");const s=window.__spatial.useApp.getState();
      s.addTask({id,label:"本地预览验收 "+id,mode:"text",state:"preview",progress:1,createdAt:Date.now(),projectId:s.projectId,sceneRevision:s.sceneRevision,taskType:"CREATE_OBJECT",assetId:"portable-fixture",
        candidate:makeObject("model","预览模型",{assetId:"portable-fixture",source:"ai",sourceTaskId:id})});
    },id);
    await prepare("ui_preview_reject");
    await page.locator(".task").filter({hasText:"ui_preview_reject"}).getByRole("button",{name:"预览",exact:true}).click();
    const accept=page.getByRole("button",{name:"接受并写入场景",exact:true});await accept.waitFor();
    await page.waitForFunction(()=>!document.querySelector('.review-actions .primary')?.disabled);
    await page.waitForTimeout(800); // Allow the preview Canvas to compile and render its first model frame.
    await page.screenshot({path:"test-artifacts/draft1/ai-preview.png"});
    await page.getByRole("button",{name:"拒绝 / 取消",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__spatial.useApp.getState().objects.length),before);
    await prepare("ui_preview_accept");
    await page.locator(".task").filter({hasText:"ui_preview_accept"}).getByRole("button",{name:"预览",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.review-actions .primary')?.disabled);await accept.click();
    assert.equal(await page.evaluate(()=>window.__spatial.useApp.getState().objects.length),before+1);
    return { provider:"local valid GLB fixture", paidProviderTested:false };
  });
  await test("T-HAND-006 lost tracking cancels stroke and held pinch cannot restart it", async () => {
    const before = await page.evaluate(() => window.__spatial.useApp.getState().objects.length);
    await page.evaluate(async () => {
      const { handState, useApp } = window.__spatial;
      const points = Array.from({length:21},()=>({x:.5,y:.5,z:0}));
      const hd = { id:0, handedness:"Left", screen:points, raw:points, world:points, view:{x:.5,y:.5}, ndc:{x:0,y:0}, pinch:.9, pinched:false, palm:.2,
        fingers:{ count:1, ext:{thumb:0,index:1,middle:0,ring:0,pinky:0}, ratio:{}, extended:{thumb:false,index:true,middle:false,ring:false,pinky:false} } };
      useApp.getState().setTool("draw");
      const frames = async (n, present, pinched) => {
        for(let i=0;i<n;i++) { hd.pinched=pinched; hd.ndc.x=i*.004;
          handState.status="ready"; handState.primary=present?hd:null; handState.hands=present?[hd]:[]; handState.updatedAt=performance.now(); handState.frames++;
          await new Promise(requestAnimationFrame);
        }
      };
      await frames(5,true,false); await frames(10,true,true); await frames(40,false,false);
      if (window.__spatial.drawRuntime.active) throw Error("stroke not cancelled after loss");
      await frames(10,true,true); if (window.__spatial.drawRuntime.active) throw Error("held pinch restarted stroke");
      await frames(5,true,false);
      handState.status="idle";handState.primary=null;handState.hands=[];handState.twoHand.active=false;handState.mouseMode=true;
      useApp.getState().cancelInteraction();useApp.getState().setTool("select");
    });
    assert.equal(await page.evaluate(() => window.__spatial.useApp.getState().objects.length), before);
  });
  await test("T-DATA-004 storage failure preserves last committed project and reports error", async () => {
    return page.evaluate(async () => {
      const { idb } = await import("/src/lib/idb.ts"), s = () => window.__spatial.useApp.getState();
      await s().save(); const before = JSON.stringify(await idb.get("project")); const actual = idb.saveProject;
      idb.saveProject = async () => { throw new DOMException("test quota exceeded", "QuotaExceededError"); };
      let rejected=false;
      try { await s().save(); } catch { rejected=true; } finally { idb.saveProject=actual; }
      if (!rejected || s().saveStatus !== "error" || !s().saveError.includes("quota")) throw Error("storage failure not surfaced");
      if (JSON.stringify(await idb.get("project")) !== before) throw Error("failed save changed committed data");
      await s().save(); return { preserved: true, errorSurfaced: true };
    });
  });
  await test("T-DATA-003 malformed project is rejected without overwriting current scene", async () => {
    return page.evaluate(async () => {
      const s = window.__spatial.useApp.getState(); const prior = JSON.stringify(s.objects);
      let rejected = false; try { await s.openProjectFile(new File([JSON.stringify({ version: 2, objects: [] })], "bad.json")); } catch { rejected = true; }
      if (!rejected || JSON.stringify(window.__spatial.useApp.getState().objects) !== prior) throw Error("malformed file changed scene");
      await window.__spatial.useApp.getState().save();
    });
  });
  await test("T-DATA-005 corrupt snapshot blocks autosave and permits explicit backup recovery", async () => {
    const restored = await page.evaluate(async()=>{
      const {idb}=await import("/src/lib/idb.ts"),s=()=>window.__spatial.useApp.getState();
      await s().save();await s().save();const before=s().objects;
      await idb.set("project",{version:2,objects:"corrupt fixture"});await s().hydrate();
      if(!s().recoveryAvailable)throw Error("corruption not detected");
      let blocked=false;try{await s().save();}catch{blocked=true;}if(!blocked)throw Error("corrupted project overwritten automatically");
      await s().restoreBackup();
      return { before, after: s().objects, status: s().saveStatus, recoveryAvailable: s().recoveryAvailable };
    });
    // Validation reconstructs property order; compare values, including every vertex and ID.
    assert.deepEqual(JSON.parse(JSON.stringify(restored.after)), JSON.parse(JSON.stringify(restored.before)));
    assert.equal(restored.status, "saved"); assert.equal(restored.recoveryAvailable, false);
    return {autosaveBlocked:true,backupRestored:true};
  });
  await test("T-DATA-RACE backup recovery waits for in-flight save and remains committed",async()=>{
    const result=await page.evaluate(async()=>{
      const {idb}=await import("/src/lib/idb.ts"),s=()=>window.__spatial.useApp.getState();
      await s().save();const before=s().objects; s().patchObject(before[0].id,{name:"in-flight save fixture"});
      const actual=idb.saveProject;let release;const gate=new Promise(resolve=>{release=resolve;});
      idb.saveProject=async snapshot=>{await gate;return actual(snapshot);};
      try{
        const pending=s().save(),recover=s().restoreBackup();release();await Promise.all([pending,recover]);
        return {before,after:s().objects,persisted:(await idb.get("project")).objects,status:s().saveStatus};
      }finally{idb.saveProject=actual;}
    });
    const normalized=value=>JSON.parse(JSON.stringify(value));
    assert.deepEqual(normalized(result.after),normalized(result.before));assert.deepEqual(normalized(result.persisted),normalized(result.before));assert.equal(result.status,"saved");
  });
  await page.evaluate(()=>{const s=window.__spatial.useApp.getState();window.__spatial.useApp.setState({toasts:[]});s.select(s.objects[0].id);});
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-artifacts/draft1/workspace.png" });
  await test("T-UI-MODAL help blocks background deletion and closes with Escape",async()=>{
    const before=await page.evaluate(()=>JSON.stringify(window.__spatial.useApp.getState().objects));
    await page.keyboard.press("h");await page.getByRole("dialog",{name:"操作指引"}).waitFor();
    await page.keyboard.press("Delete");assert.equal(await page.evaluate(()=>JSON.stringify(window.__spatial.useApp.getState().objects)),before);
    await page.screenshot({path:"test-artifacts/draft1/help.png"});await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"操作指引"}).waitFor({state:"detached"});
  });
  await test("T-UI-001 no runtime errors", async () => assert.deepEqual(errors, []));
} finally {
  writeFileSync("test-artifacts/draft1/results.json", JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), tests: results, runtimeErrors: errors, note: "Synthetic/browser regression only; no real camera users or paid AI provider acceptance." }, null, 2));
  await browser.close();
}
console.log(`${results.filter(r=>r.status==="PASS").length}/${results.length} passed`);
process.exitCode = results.some(r => r.status === "FAIL") ? 1 : 0;
