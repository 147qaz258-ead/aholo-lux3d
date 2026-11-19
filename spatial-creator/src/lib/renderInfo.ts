export const renderInfo = { renderer: "", pixelRatio: 1 };

export function webGlRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? "");
}

export function isSoftwareRenderer(renderer: string) {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
}
