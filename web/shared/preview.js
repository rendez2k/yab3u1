// A small WebGL preview: triangle soup in, orbit/zoom/pan out.
//
// No framework and no CDN: the whole renderer is these ~200 lines, so the page
// keeps working offline with nothing loaded from anyone else.  The soup is
// already in world space with per-vertex colours, so the picture matches the
// export's placement and the plan's palette exactly; the only thing computed here
// is flat shading from the face normals.

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aColor;
in vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec3 vColor;
out vec3 vNormal;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vColor = aColor;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec3 vColor;
in vec3 vNormal;
out vec4 outColor;
uniform vec3 uLight;
uniform float uAmbient;
void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(uLight)), 0.0);
  float wrap = 0.35 * max(dot(normal, normalize(vec3(-uLight.x, -uLight.y, uLight.z))), 0.0);
  vec3 shade = vColor * (uAmbient + 0.75 * diffuse + wrap);
  outColor = vec4(clamp(shade, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`preview shader failed: ${log}`);
  }
  return shader;
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    this.ok = Boolean(this.gl);
    this.error = this.ok ? "" : "this browser has no WebGL2 context, so the 3D "
      + "preview is unavailable";
    this.count = 0;
    this.bounds = null;
    this.lastPositions = null;      // the geometry whose buffers are uploaded
    this.frame = 0;                 // pending animation-frame id, if any
    this.yaw = -0.6;
    this.pitch = 0.5;
    this.distance = 1;
    this.pan = [0, 0];
    this.dragging = null;
    this.last = [0, 0];
    if (!this.ok) return;
    const gl = this.gl;
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      this.ok = false;
      this.error = `preview program failed: ${gl.getProgramInfoLog(this.program)}`;
      return;
    }
    this.buffers = {
      position: gl.createBuffer(),
      color: gl.createBuffer(),
      normal: gl.createBuffer(),
    };
    this.uniforms = {
      viewProjection: gl.getUniformLocation(this.program, "uViewProjection"),
      model: gl.getUniformLocation(this.program, "uModel"),
      light: gl.getUniformLocation(this.program, "uLight"),
      ambient: gl.getUniformLocation(this.program, "uAmbient"),
    };
    this.attributes = {
      position: gl.getAttribLocation(this.program, "aPosition"),
      color: gl.getAttribLocation(this.program, "aColor"),
      normal: gl.getAttribLocation(this.program, "aNormal"),
    };
    gl.enable(gl.DEPTH_TEST);
    this.bindEvents();
    // Dialogs and grid panels can change size without a window resize. Keep the
    // drawing buffer at the displayed size instead of stretching a 300×150 image.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  bindEvents() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = event.button === 2 || event.shiftKey ? "pan" : "orbit";
      this.last = [event.clientX, event.clientY];
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.last[0];
      const dy = event.clientY - this.last[1];
      this.last = [event.clientX, event.clientY];
      if (this.dragging === "orbit") {
        this.yaw += dx * 0.01;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.01));
      } else {
        this.pan[0] -= dx * this.distance * 0.0015;
        this.pan[1] += dy * this.distance * 0.0015;
      }
      this.requestDraw();
    });
    const stop = (event) => {
      this.dragging = null;
      if (event.pointerId !== undefined) {
        try { canvas.releasePointerCapture(event.pointerId); } catch (error) { /* fine */ }
      }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance *= event.deltaY > 0 ? 1.12 : 0.89;
      this.clampDistance();
      this.requestDraw();
    }, { passive: false });
  }

  /** One frame at a time: pointer and wheel events coalesce into a single draw. */
  requestDraw() {
    if (this.frame || !this.ok) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Re-upload only the colours of the geometry already on the GPU. */
  setColors(colors) {
    if (!this.ok || !this.count || !this.lastPositions) return false;
    if (!colors || colors.length !== this.lastPositions.length) return false;
    this.upload(this.buffers.color, this.attributes.color, colors, 3);
    this.requestDraw();
    return true;
  }

  setSoup(positions, colors, { fit = true } = {}) {
    if (!this.ok) return;
    if (!positions || !positions.length) {
      this.count = 0;
      this.bounds = null;
      this.lastPositions = null;
      this.requestDraw();
      return;
    }
    // Same geometry, new colours: the positions, normals and their buffers are
    // already uploaded, so a palette or Original/Result change is one small
    // buffer write instead of another full parse and re-upload.
    if (positions === this.lastPositions && this.count === positions.length / 3) {
      this.setColors(colors);
      if (fit) this.reset();
      return;
    }
    const gl = this.gl;
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      for (let v = 0; v < 3; v += 1) {
        normals[i + v * 3] = nx;
        normals[i + v * 3 + 1] = ny;
        normals[i + v * 3 + 2] = nz;
      }
    }
    this.upload(this.buffers.position, this.attributes.position, positions, 3);
    this.upload(this.buffers.color, this.attributes.color, colors, 3);
    this.upload(this.buffers.normal, this.attributes.normal, normals, 3);
    this.count = positions.length / 3;
    this.lastPositions = positions;
    const hadGeometry = Boolean(this.bounds);
    this.bounds = bounds(positions);
    if (fit || !hadGeometry) {
      // A new selection is a new thing to look at; re-colouring the same geometry
      // is not, so the camera stays where the user put it.
      this.reset();
    } else {
      this.clampDistance();
      this.requestDraw();
    }
  }

  upload(buffer, location, data, size) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  reset() {
    this.yaw = -0.6;
    this.pitch = 0.5;
    this.pan = [0, 0];
    if (this.bounds) {
      this.distance = fitDistance(this.bounds.size,
        this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), this.yaw, this.pitch);
    } else {
      this.distance = 120;
    }
    this.clampDistance();
    this.requestDraw();
  }

  /** Zoom limits scale with the model: millimetre models are hundreds of units
   *  across, so a fixed 0.2..6 range would put the camera inside the part. */
  clampDistance() {
    const span = this.bounds
      ? Math.max(this.bounds.size[0], this.bounds.size[1], this.bounds.size[2], 1)
      : 120;
    this.distance = Math.max(span * 0.15, Math.min(span * 8, this.distance));
  }

  resize() {
    if (!this.ok) return;
    // A 3x phone display would otherwise rasterise three times the pixels for no
    // visible gain on a 3D view.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.requestDraw();
  }

  draw() {
    if (!this.ok) return;
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.09, 0.10, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count || !this.bounds) return;

    const centre = this.bounds.centre;
    const view = identity();
    const cosPitch = Math.cos(this.pitch);
    const eye = [
      centre[0] + this.distance * cosPitch * Math.sin(this.yaw) + this.pan[0],
      centre[1] - this.distance * cosPitch * Math.cos(this.yaw) + this.pan[1],
      centre[2] + this.distance * Math.sin(this.pitch),
    ];
    lookAt(view, eye, [centre[0] + this.pan[0], centre[1] + this.pan[1], centre[2]],
           [0, 0, 1]);
    const projection = perspective(Math.PI / 4, width / Math.max(1, height),
                                   Math.max(0.1, this.distance * 0.01),
                                   this.distance * 40 + 1000);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.viewProjection, false,
                        multiply(projection, view));
    gl.uniformMatrix4fv(this.uniforms.model, false, identity());
    gl.uniform3f(this.uniforms.light, 0.4, -0.6, 0.7);
    gl.uniform1f(this.uniforms.ambient, 0.35);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

/** Fit every corner of the bounds in the current camera, with a little margin.
 * Accounting for aspect ratio avoids both a tiny model on desktop and clipped
 * sides on a narrow phone. Geometry and colours are never altered by framing. */
export function fitDistance(size, aspect, yaw=-0.6, pitch=0.5) {
  const cp=Math.cos(pitch), sp=Math.sin(pitch), sy=Math.sin(yaw), cy=Math.cos(yaw);
  const right=[cy,sy,0], up=[-sp*sy,sp*cy,cp], toward=[cp*sy,-cp*cy,sp];
  const vertical=Math.tan(Math.PI/8), horizontal=vertical*Math.max(0.1,aspect);
  let distance=0;
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) {
    const corner=[x*size[0]/2,y*size[1]/2,z*size[2]/2];
    distance=Math.max(distance,dot(corner,toward)+1.15*Math.max(
      Math.abs(dot(corner,right))/horizontal,Math.abs(dot(corner,up))/vertical));
  }
  return Math.max(distance,1);
}

function bounds(positions) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis], positions[i + axis]);
      hi[axis] = Math.max(hi[axis], positions[i + axis]);
    }
  }
  return {
    lo, hi,
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
  };
}

function lookAt(out, eye, centre, up) {
  const z = normalise([eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]]);
  const upN = normalise(up);
  const x = normalise(cross(upN, z));
  const y = cross(z, x);
  out.set([x[0], y[0], z[0], 0,
           x[1], y[1], z[1], 0,
           x[2], y[2], z[2], 0,
           -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return out;
}

const normalise = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function soupFromBase64(payload) {
  const positions = decodeFloats(payload.positions);
  const colors = decodeFloats(payload.colors);
  return { positions, colors };
}

function decodeFloats(text) {
  const binary = atob(text || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
