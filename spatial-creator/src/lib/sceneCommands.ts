import { useApp } from "../store";
import type { AiTask, SceneObject, Vec3 } from "../types";
import { descendants } from "./assembly";
const colors:Record<string,string>={红色:"#ff5d7a",蓝色:"#8fb4ff",绿色:"#2ee8c8",白色:"#ffffff",黑色:"#111111",黄色:"#ffd28f",紫色:"#c79cff"};
export function explainScene(){
  const s=useApp.getState();
  return `作品「${s.projectName}」有 ${s.objects.length} 个对象（可见 ${s.objects.filter(o=>o.visible).length} 个、锁定 ${s.objects.filter(o=>o.locked).length} 个），${s.assemblies.length} 个装配体。有效连接 ${s.relations.filter(r=>r.status==="valid").length} 条，失效连接 ${s.relations.filter(r=>r.status==="broken").length} 条。`+
    (s.selectedId?`当前目标「${s.objects.find(o=>o.id===s.selectedId)?.name}」。`:"当前未选中对象。");
}
export function resolveTarget(text:string){
  const s=useApp.getState(),quoted=text.match(/[「“"]([^」”"]+)[」”"]/),named=quoted?s.objects.filter(o=>o.name===quoted[1]):s.objects.filter(o=>o.name.length>0&&text.includes(o.name));
  if(named.length>1)throw new Error("匹配多个对象，请用引号写完整唯一名称或先在列表选择");
  if(quoted&&!named.length)throw new Error(`没有找到对象「${quoted[1]}」`);
  if(named.length===1)return named[0];
  if(/刚才|上一个|上一轮/.test(text)){
    const last=s.tasks.find(t=>t.state==="accepted"&&t.acceptedObjectId);
    const target=s.objects.find(o=>o.id===last?.acceptedObjectId);if(target)return target;
    throw new Error("没有可引用的上一轮结果，请明确选择对象");
  }
  if(s.selectedIds.length>1)throw new Error("当前选择多个对象，请指定一个目标");
  const target=s.objects.find(o=>o.id===s.selectedId);if(!target)throw new Error("请先选择目标对象或用引号指定名称");return target;
}
export function localTask(target:SceneObject,candidate:SceneObject,prompt:string,operation:AiTask["localOperation"]):AiTask{
  const s=useApp.getState(),last=s.tasks.find(t=>t.state==="accepted"&&t.acceptedObjectId===target.id);
  return {id:crypto.randomUUID(),label:prompt.slice(0,32),mode:"text",state:"preview",progress:1,createdAt:Date.now(),projectId:s.projectId,sceneRevision:s.sceneRevision,
    taskType:operation==="region"?"MODIFY_REGION":"MODIFY_OBJECT",targetObjectId:target.id,targetObjectVersion:target.version??1,parentTaskId:last?.id,prompt,candidate,localOperation:operation,cost:0,message:"本地编辑预览，尚未写入"};
}
function applySingleClause(clause: string, target: SceneObject, candidate: SceneObject): AiTask["localOperation"] {
  const prefix = String.raw`^(?:请)?(?:把|将)?(?:「[^」]+」|“[^”]+”|"[^"]+"|刚才那个|上一轮对象|上一个对象|它|选中对象|当前对象)?\s*`;
  const scale = clause.match(new RegExp(prefix + String.raw`(缩小|放大)\s*(\d+(?:\.\d+)?)\s*[%％][。！!]?\s*$`));
  if (scale) {
    if (descendants(useApp.getState().objects, target.id).size > 1) throw new Error("目标含子对象，请使用整体变换");
    const factor = 1 + (Number(scale[2]) / 100) * (scale[1] === "缩小" ? -1 : 1);
    if (factor <= 0 || factor > 10) throw new Error("缩放比例超出范围");
    candidate.transform.scale = candidate.transform.scale.map((n) => n * factor) as Vec3;
    if (candidate.transform.scale.some((n) => n > 1000)) throw new Error("缩放超过场景上限");
    return "transform";
  }
  const move = clause.match(new RegExp(prefix + String.raw`向(右|左|上|下|前|后)(?:移动|移)?\s*(\d+(?:\.\d+)?)[。！!]?\s*$`));
  if (move) {
    if (descendants(useApp.getState().objects, target.id).size > 1) throw new Error("目标含子对象，请使用整体变换");
    const axis = { 右: 0, 左: 0, 上: 1, 下: 1, 前: 2, 后: 2 }[move[1]]!;
    candidate.transform.position[axis] += Number(move[2]) * (/左|下|后/.test(move[1]) ? -1 : 1);
    return "transform";
  }
  const rotate = clause.match(new RegExp(prefix + String.raw`(?:绕\s*([XYZxyz])\s*轴?|向(左|右))?(?:旋转|转)\s*(-?\d+(?:\.\d+)?)\s*度?[。！!]?\s*$`));
  if (rotate) {
    if (descendants(useApp.getState().objects, target.id).size > 1) throw new Error("目标含子对象，请使用整体变换");
    const axisIdx = rotate[1] ? { x: 0, y: 1, z: 2 }[rotate[1].toLowerCase()]! : 1;
    const sign = rotate[2] === "左" ? -1 : 1;
    candidate.transform.rotation[axisIdx] += (Number(rotate[3]) * sign * Math.PI) / 180;
    return "transform";
  }
  if (new RegExp(prefix + String.raw`(?:贴地|放到地面|对齐地面|落地)[。！!]?\s*$`).test(clause)) {
    if (descendants(useApp.getState().objects, target.id).size > 1) throw new Error("目标含子对象，请使用整体变换");
    candidate.transform.position[1] = 0;
    return "transform";
  }
  const color = clause.match(new RegExp(prefix + String.raw`(?:改成|改为|变成|设为|颜色为)\s*(#[a-fA-F0-9]{6}|红色|蓝色|绿色|白色|黑色|黄色|紫色)[。！!]?\s*$`));
  if (color) {
    candidate.color = colors[color[1]] ?? color[1];
    if (candidate.kind === "model") candidate.material ??= { roughness: .34, metalness: .24, opacity: 1, emissiveIntensity: .14 };
    return "material";
  }
  throw new Error("暂不支持这条指令。可用：把它缩小10%、把「对象名」向右移动0.2、绕Y旋转45度、贴地、把刚才那个改为蓝色，或解释场景。自由形体生成请使用远程生成。");
}

/** Explicit, bounded local grammar. Unsupported language never falls back to model generation. */
export function planSceneCommand(text:string):AiTask{
  text=text.trim();if(!text||text.length>600)throw new Error("请输入 600 字符内的场景指令");
  if(/^(解释|说明|查看)(当前)?(场景|作品)[。！!？?]?$/.test(text)){const s=useApp.getState();return {id:crypto.randomUUID(),label:"场景说明",mode:"text",state:"success",progress:1,createdAt:Date.now(),projectId:s.projectId,taskType:"EXPLAIN_SCENE",prompt:text,explanation:explainScene(),cost:0};}
  const target=resolveTarget(text);if(target.locked)throw new Error("目标已锁定，请先解锁");
  const candidate=structuredClone(target);candidate.sourceObjectIds=[target.id];
  const clauses = text.split(/[，,;；]|(?:并且|并|且)(?=把|将|向|绕|缩|放|改|设|贴|落)/).map((c) => c.trim()).filter(Boolean);
  let op: AiTask["localOperation"] = "transform";
  for (const clause of clauses) {
    op = applySingleClause(clause, target, candidate);
  }
  return localTask(target, candidate, text, op);
}
