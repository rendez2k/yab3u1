// An un-antialiased ID pass gives the brush the visible model's occlusion.
// Its buffers never replace the preview's colours or positions.
const vertex=`#version 300 es
layout(location=0) in vec3 aPosition;
uniform mat4 uMatrix;
flat out highp int vFace;
void main(){gl_Position=uMatrix*vec4(aPosition,1.0);vFace=gl_VertexID/3+1;}`;
const fragment=`#version 300 es
precision highp float;
precision highp int;
flat in int vFace;
uniform bool uModel;
uniform bool uOverlay;
out vec4 outColor;
void main(){
  if(uOverlay){outColor=vec4(0.1,0.65,0.48,0.52);return;}
  int id=uModel?vFace:0;
  outColor=vec4(float(id&255),float((id>>8)&255),float((id>>16)&255),255.0)/255.0;
}`;
export class FocusPicking {
  constructor(preview) {
    this.preview=preview;const gl=this.gl=preview.gl;
    this.program=gl.createProgram();
    for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(this.program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    this.matrix=gl.getUniformLocation(this.program,'uMatrix');this.model=gl.getUniformLocation(this.program,'uModel');this.overlay=gl.getUniformLocation(this.program,'uOverlay');
    this.vao=gl.createVertexArray();this.framebuffer=gl.createFramebuffer();this.texture=gl.createTexture();this.depth=gl.createRenderbuffer();this.highlight=gl.createBuffer();this.highlightCount=0;
  }
  bind(buffer) {
    const gl=this.gl;gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
    gl.useProgram(this.program);gl.uniformMatrix4fv(this.matrix,false,this.preview.viewProjection);
  }
  capture() {
    const p=this.preview,gl=this.gl;p.draw();
    const rect=p.canvas.getBoundingClientRect(),scale=Math.min(1,1024/Math.max(rect.width,rect.height)),
      width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
    const dither=gl.isEnabled(gl.DITHER);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      if(width!==this.width||height!==this.height) {
        gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
        gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
        this.width=width;this.height=height;
      }
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('The browser could not prepare the surface brush.');
      gl.viewport(0,0,width,height);gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(p.view!=='model'&&p.plate){this.bind(p.plate.buffers.position);gl.uniform1i(this.model,0);gl.uniform1i(this.overlay,0);gl.drawArrays(gl.TRIANGLES,0,p.plate.position.length/3);}
      this.bind(p.buffers.position);gl.uniform1i(this.model,1);gl.uniform1i(this.overlay,0);gl.drawArrays(gl.TRIANGLES,0,p.count);
      const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return {pixels,width,height,cssWidth:rect.width,cssHeight:rect.height};
    } finally {
      gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindRenderbuffer(gl.RENDERBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);
      if(dither)gl.enable(gl.DITHER);gl.viewport(0,0,p.canvas.width,p.canvas.height);p.requestDraw();
    }
  }
  setHighlight(positions) {
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.highlight);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.DYNAMIC_DRAW);this.highlightCount=positions.length/3;
  }
  drawHighlight() {
    if(!this.highlightCount)return;
    const gl=this.gl;this.bind(this.highlight);gl.uniform1i(this.overlay,1);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
    gl.drawArrays(gl.TRIANGLES,0,this.highlightCount);
    gl.disable(gl.POLYGON_OFFSET_FILL);gl.depthMask(true);gl.depthFunc(gl.LESS);gl.disable(gl.BLEND);gl.bindVertexArray(null);
  }
}
