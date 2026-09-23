// The saved thumbnail: software raster, canvas-free PNG, and the archive
// packaging that Windows Explorer and the slicers read.
//
// Run from the project root:  node web/tests/thumbnail.test.mjs

import assert from "node:assert/strict";

import { encodePng, readPng, assertPng } from "../shared/png.js";
import { downscale, renderIso } from "../shared/raster.js";
import { REL_COVER_SMALL, REL_THUMBNAIL, thumbnailPlan,
         thumbnailSizes } from "../shared/thumbnail.js";
import * as project from "../shared/project.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let checks = 0;
const failures = [];

async function ok(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log("PASS", name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log("FAIL", name, error.message);
  }
}

/** An independent PNG reader: inflate the IDAT and undo filter type 0. */
async function decodePng(bytes) {
  const info = readPng(bytes);
  assert.ok(info, "not a PNG");
  const parts = [];
  let at = 8;
  while (at < bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8)
      | bytes[at + 3]) >>> 0;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6],
                                     bytes[at + 7]);
    if (type === "IDAT") parts.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
    if (type === "IEND") break;
  }
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const stream = new DecompressionStream("deflate");
  const drained = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(joined);
  await writer.close();
  const raw = new Uint8Array(await drained);
  const stride = info.width * 4;
  const pixels = new Uint8Array(info.width * info.height * 4);
  for (let row = 0; row < info.height; row += 1) {
    assert.equal(raw[row * (stride + 1)], 0, "the test only writes filter 0");
    pixels.set(raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride),
               row * stride);
  }
  return { ...info, pixels };
}

/* ---------- PNG ---------- */

await ok("the encoder writes a real RGBA PNG the reader can inflate", async () => {
  const rgba = new Uint8ClampedArray(4 * 3 * 4);
  for (let pixel = 0; pixel < 12; pixel += 1) {
    rgba[pixel * 4] = 200;
    rgba[pixel * 4 + 1] = 30;
    rgba[pixel * 4 + 2] = 90;
    rgba[pixel * 4 + 3] = 255;
  }
  const png = await encodePng(rgba, 4, 3);
  const info = assertPng(png, 4, 3, "the test image");
  assert.equal(info.depth, 8);
  assert.equal(info.colourType, 6);
  const decoded = await decodePng(png);
  assert.equal(decoded.pixels.length, 48);
  assert.deepEqual([...decoded.pixels.subarray(0, 4)], [200, 30, 90, 255]);
  assert.deepEqual([...decoded.pixels.subarray(44, 48)], [200, 30, 90, 255],
                   "the last pixel survives too");
});

await ok("the encoder scales past one deflate block", async () => {
  // 300×300 RGBA raw is 360 KB, several stored blocks if compression is missing.
  const rgba = new Uint8ClampedArray(300 * 300 * 4);
  for (let pixel = 0; pixel < 300 * 300; pixel += 1) {
    rgba[pixel * 4 + 3] = 255;
  }
  const png = await encodePng(rgba, 300, 300);
  const decoded = await decodePng(png);
  assert.equal(decoded.width, 300);
  assert.deepEqual([...decoded.pixels.subarray(300 * 300 * 4 - 4)],
                   [0, 0, 0, 255]);
});

/* ---------- raster ---------- */

/** A unit tetrahedron, one flat colour per facet. */
function tetra(colours) {
  const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const faces = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
  const positions = [];
  const colors = [];
  faces.forEach((face, index) => {
    for (const corner of face) positions.push(...points[corner]);
    const colour = colours[index % colours.length];
    for (let corner = 0; corner < 3; corner += 1) colors.push(...colour);
  });
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors) };
}

const RED = [1, 0, 0];
const BLUE = [0, 0, 1];

await ok("the rasteriser fills pixels and leaves the background", () => {
  const { positions, colors } = tetra([RED]);
  const image = renderIso(positions, colors, { size: 96 });
  assert.equal(image.width, 96);
  assert.equal(image.data.length, 96 * 96 * 4);
  let red = 0;
  let background = 0;
  for (let pixel = 0; pixel < 96 * 96; pixel += 1) {
    const at = pixel * 4;
    if (image.data[at] === 255 && image.data[at + 1] === 0) red += 1;
    if (image.data[at] === 242 && image.data[at + 1] === 244) background += 1;
  }
  assert.ok(red > 500, `expected a solid model, got ${red} red pixels`);
  assert.ok(background > 500, "the corners should still be background");
  assert.equal(image.data.length, image.width * image.height * 4);
});

await ok("the image follows the colours it is given", () => {
  const first = renderIso(tetra([RED]).positions, tetra([RED]).colors, { size: 64 });
  const second = renderIso(tetra([BLUE]).positions, tetra([BLUE]).colors, { size: 64 });
  const pixels = (image) => {
    let red = 0;
    let blue = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
      const at = pixel * 4;
      if (image.data[at] > 200 && image.data[at + 2] < 60) red += 1;
      if (image.data[at + 2] > 200 && image.data[at] < 60) blue += 1;
    }
    return { red, blue };
  };
  assert.deepEqual(pixels(first), { red: first.width * first.height
    - countBackground(first), blue: 0 });
  assert.ok(pixels(second).blue > 0 && pixels(second).red === 0,
            "a blue model must not contain red pixels");
});

function countBackground(image) {
  let count = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const at = pixel * 4;
    if (image.data[at] === 242 && image.data[at + 1] === 244) count += 1;
  }
  return count;
}

await ok("an empty selection is an explicit error, not a blank image", () => {
  assert.throws(() => renderIso(new Float32Array(0), new Float32Array(0)),
                /no geometry/);
});

await ok("a 512 image downscales to the 128 cover", () => {
  const { positions, colors } = tetra([RED, BLUE]);
  const image = renderIso(positions, colors, { size: 512 });
  const small = downscale(image, 128);
  assert.equal(small.width, 128);
  assert.equal(small.height, 128);
  assert.equal(small.data.length, 128 * 128 * 4);
  assert.ok(small.data.some((value, index) => index % 4 === 3 && value === 255),
            "the cover keeps the model's pixels");
});

/* ---------- packaging ---------- */

function source({ colours, types, codes }) {
  const triangle = (code) => `<triangle v1="0" v2="1" v3="2"`
    + `${code ? ` paint_color="${code}"` : ""}/>`;
  const mesh = `<object id="2" type="model"><mesh><vertices>`
    + `<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>`
    + `<vertex x="0" y="1" z="0"/></vertices><triangles>`
    + codes.map(triangle).join("") + `</triangles></mesh></object>`;
  const root = `<object id="1" type="model"><components>`
    + `<component objectid="2"/></components></object>`;
  const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"`
    + ` unit="millimeter"><resources>${mesh}${root}</resources>`
    + `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/></build></model>`;
  const config = `<config><object id="1">`
    + `<metadata key="name" value="Part"/><metadata key="extruder" value="1"/>`
    + `<part id="2" subtype="normal_part"><metadata key="name" value="body"/>`
    + `<metadata key="extruder" value="1"/></part></object>`
    + `<plate><metadata key="plater_id" value="1"/>`
    + `<model_instance><metadata key="object_id" value="1"/>`
    + `<metadata key="instance_id" value="0"/></model_instance></plate></config>`;
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/project_settings.config", encoder.encode(JSON.stringify({
      filament_colour: colours, filament_type: types }))],
    ["Metadata/model_settings.config", encoder.encode(config)],
  ]);
}

const FIVE = { colours: ["#0080C0", "#FF0000", "#FFFFFF", "#000000", "#C5C263"],
               types: ["PLA", "PLA", "PLA", "PLA", "PLA"],
               codes: ["4", "1C", "2C", ""] };

/** Render the PNGs a target needs, exactly as the page's worker would. */
async function render(target) {
  const sizes = thumbnailSizes(target);
  const { positions, colors } = tetra([RED, BLUE, [0, 1, 0]]);
  const image = renderIso(positions, colors, { size: sizes.main });
  const main = await encodePng(image.data, image.width, image.height);
  let small = null;
  if (sizes.small) {
    const scaled = downscale(image, sizes.small);
    small = await encodePng(scaled.data, scaled.width, scaled.height);
  }
  return { main, small };
}

for (const target of ["snapmaker", "bambu", "orca", "prusa"]) {
  await ok(`a ${target} export carries the members, relationships and sizes`, async () => {
    const parsed = project.readProject(source(FIVE));
    const thumbnails = await render(target);
    const built = project.convertProject(parsed, 1, null, { target, thumbnails });
    assert.deepEqual(built.problems, [], built.problems.join("; "));
    const sizes = thumbnailSizes(target);
    const mainName = target === "prusa" ? "Metadata/thumbnail.png"
      : "Metadata/plate_1.png";
    assert.ok(built.entries.has(mainName), `${mainName} is missing`);
    assertPng(built.entries.get(mainName), sizes.main, sizes.main, mainName);

    const rels = decoder.decode(built.entries.get("_rels/.rels"));
    assert.ok(rels.includes(REL_THUMBNAIL), "the standard thumbnail relationship");
    assert.ok(rels.includes(`Target="/${mainName}"`),
              "the standard relationship points at the real member");
    const ids = [...rels.matchAll(/Id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `duplicate relationship ids: ${ids}`);
    const types = decoder.decode(built.entries.get("[Content_Types].xml"));
    assert.ok(types.includes('Extension="png" ContentType="image/png"'),
              "the package must declare the PNG content type");

    if (sizes.small) {
      assert.ok(built.entries.has("Metadata/plate_1_small.png"),
                "the 128 cover is missing");
      assertPng(built.entries.get("Metadata/plate_1_small.png"), sizes.small,
                sizes.small, "the cover");
      assert.ok(rels.includes(REL_COVER_SMALL) && rels.includes(
        "http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"));
      const settings = decoder.decode(built.entries.get("Metadata/model_settings.config"));
      assert.ok(settings.includes('key="thumbnail_file" value="Metadata/plate_1.png"'),
                "the plate metadata should name the thumbnail");
      assert.equal(built.thumbnails && built.thumbnails.main, mainName);
    } else {
      assert.ok(!built.entries.has("Metadata/plate_1.png"),
                "a Prusa project must not carry the Bambu member names");
      assert.equal(built.thumbnails && built.thumbnails.small, null);
    }
  });
}

await ok("a Bambu-family project reopens with its objects on the thumbnail's plate",
         async () => {
  const parsed = project.readProject(source(FIVE));
  const thumbnails = await render("bambu");
  const built = project.convertProject(parsed, 1, null, { target: "bambu", thumbnails });
  const reread = project.readProject(built.entries);
  assert.equal(reread.plates.length, 1, "the plate metadata must not invent a plate");
  assert.deepEqual(reread.plates[0].objectIds, ["1"]);
  const again = project.convertProject(reread, reread.plates[0].id, null,
                                       { target: "bambu" });
  assert.deepEqual(again.problems, []);
});

await ok("a source with no thumbnail still gets one", async () => {
  const parsed = project.readProject(source(FIVE));
  assert.ok(!parsed.entries.has("Metadata/plate_1.png"),
            "the fixture starts without a picture");
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", thumbnails: await render("bambu") });
  assert.ok(built.entries.has("Metadata/plate_1.png"));
});

await ok("an engine-only export writes no PNG members and no thumbnail rels", () => {
  const parsed = project.readProject(source(FIVE));
  const built = project.convertProject(parsed, 1, null, { target: "bambu" });
  assert.ok(![...built.entries.keys()].some((name) => name.endsWith(".png")));
  assert.ok(!decoder.decode(built.entries.get("_rels/.rels")).includes(REL_THUMBNAIL));
  assert.equal(built.thumbnails, null);
});

await ok("a wrong-sized or missing thumbnail is refused, not written", async () => {
  const parsed = project.readProject(source(FIVE));
  const wrong = await encodePng(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
  assert.throws(() => project.convertProject(parsed, 1, null,
                                             { target: "bambu", thumbnails: { main: wrong } }),
                /512x512/);
  assert.throws(() => project.convertProject(parsed, 1, null,
                                             { target: "bambu",
                                               thumbnails: { main: Uint8Array.from([1, 2, 3]) } }),
                /not a PNG/);
  const sizes = thumbnailSizes("bambu");
  const good = await render("bambu");
  assert.throws(() => thumbnailPlan({ target: "bambu", thumbnails: { main: good.main } }),
                /128px cover/);
  assert.equal(sizes.small, 128);
});

if (failures.length) {
  console.error(`\n${failures.length} thumbnail check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`thumbnail ok: ${checks} checks`);
}
