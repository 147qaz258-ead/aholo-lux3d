export async function imageReference(file: File) {
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>4*1024*1024)throw new Error("请使用 4MB 以内的 PNG、JPEG 或 WebP 图片");
  const bytes=await file.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
  const image=await createImageBitmap(file);const valid=image.width<=4096&&image.height<=4096;image.close();
  if(!valid)throw new Error("图片尺寸不超过 4096×4096");
  return {name:file.name,hash,dataUrl};
}
