export type Vec3 = [number, number, number];

export type ToolId = "select" | "draw" | "sculpt" | "ai";

export type ObjectKind = "primitive" | "model" | "stroke" | "extrusion";

export type PrimitiveType = "box" | "sphere" | "cylinder" | "torus" | "cone";

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}
export interface CameraView { position: Vec3; target: Vec3; projection?: "perspective" | "orthographic"; orthoHeight?: number; up?: Vec3 }
export interface MaterialSettings {
  roughness: number; metalness: number; opacity: number; emissiveIntensity: number;
  texture?: { dataUrl: string; name: string; hash: string };
}

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  name: string;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  color: string;
  material?: MaterialSettings;
  /** primitive */
  primitive?: { type: PrimitiveType; params: Record<string, number> };
  /** model: IndexedDB 中的资产键 */
  assetId?: string;
  /** stroke */
  points?: Vec3[];
  planeNormal?: Vec3;
  extrusion?: { contour: Vec3[]; normal: Vec3; thickness: number };
  width?: number;
  /** 形变后的顶点偏移是否已存在，用于提示 */
  deformed?: boolean;
  createdAt: number;
  version?: number;
  source?: "manual" | "stroke" | "ai" | "import";
  sourceTaskId?: string;
  sourceObjectIds?: string[];
  parentId?: string;
  localTransform?: Transform;
  partId?: string;
  geometryEdits?: Record<string, number[]>;
  rawPoints?: Vec3[];
  planeId?: string;
  strokeId?: string;
  geometryType?: "tube" | "curve" | "surface";
}

export interface GeneratedAsset {
  id: string;
  name: string;
  taskId: number;
  sourceUrl: string;
  createdAt: number;
  bytes: number;
  prompt?: string;
  imageUrls?: string[];
}

export type TaskState = "queued" | "running" | "success" | "failed" | "uploading" | "preview" | "accepted" | "rejected" | "cancelled" | "conflicted" | "timed_out";
export type AiTaskType = "CREATE_OBJECT" | "GENERATE_PART" | "REPLACE_OBJECT" | "CONTINUE_FROM_SKETCH" | "MODIFY_OBJECT" | "MODIFY_REGION" | "EXPLAIN_SCENE";

export interface AiTask {
  id: string;
  label: string;
  mode: "text" | "image";
  taskId?: number;
  state: TaskState;
  message?: string;
  progress: number;
  createdAt: number;
  assetId?: string;
  requestId?: string;
  projectId?: string;
  sceneRevision?: number;
  taskType?: AiTaskType;
  targetObjectId?: string;
  targetObjectVersion?: number;
  prompt?: string;
  context?: string;
  providerPrompt?: string;
  candidate?: SceneObject;
  acceptedObjectId?: string;
  durationMs?: number;
  cost?: number | "unknown";
  parentTaskId?: string;
  localOperation?: "transform" | "material" | "region";
  explanation?: string;
  region?: {center:Vec3;radius:number;delta:Vec3};
  references?: { name: string; hash: string; dataUrl: string; purpose: "appearance" | "detail" | "material" | "outline" }[];
}

export interface Calibration {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  deviceId?: string;
  mirror?: boolean;
}

export interface Settings {
  calibration: Calibration | null;
  mirror: boolean;
  smoothing: number; // 0..1
  pinchSensitivity: number; // 0.2..0.8
  sculptRadius: number; // 对象包围盒对角线比例，交互时限制为 0.05..0.2
  sculptStrength: number;
  showHandSkeleton: boolean;
  showGrid: boolean;
  autoRotate: boolean;
  drawPlane: "camera" | "xy" | "xz" | "yz";
  drawDepth: number;
  strokeSmoothing: number;
  dwellClick?: boolean;
}

export interface Connector {
  id: string;
  partId: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  axis: Vec3;
}
export interface AssemblyRelation {
  id: string;
  parentPartId: string;
  childPartId: string;
  parentConnectorId: string;
  childConnectorId: string;
  type: "fixed" | "hinge" | "slider";
  status: "valid" | "broken" | "suppressed";
  limits?: { min: number; max: number; value: number };
}
export interface Assembly {
  id: string;
  name: string;
  rootPartId: string;
  partIds: string[];
  transform: Transform;
  version: number;
}
