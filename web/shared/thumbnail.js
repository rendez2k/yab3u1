// Where a saved project's thumbnail lives, and how it is referenced.
//
// Verified against the user's own samples: a Bambu-family project carries
// `Metadata/plate_1.png` (512) and `Metadata/plate_1_small.png` (128) with the
// standard thumbnail relationship plus Bambu's `cover-thumbnail-middle` /
// `cover-thumbnail-small`; a PrusaSlicer project carries `Metadata/thumbnail.png`
// (256) with the standard package thumbnail relationship.  Windows Explorer's
// .3mf thumbnail handler reads exactly that standard relationship, which is why
// an unreferenced PNG member would not fix the missing thumbnail.

import { assertPng } from "./png.js";

export const REL_THUMBNAIL =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";
export const REL_COVER_MIDDLE =
  "http://schemas.bambulab.com/package/2021/cover-thumbnail-middle";
export const REL_COVER_SMALL =
  "http://schemas.bambulab.com/package/2021/cover-thumbnail-small";

export const THUMBNAIL_MAIN = "Metadata/plate_1.png";
export const THUMBNAIL_SMALL = "Metadata/plate_1_small.png";
export const PRUSA_THUMBNAIL = "Metadata/thumbnail.png";

const BAMBU_FAMILY = ["snapmaker", "bambu", "orca"];
export const THUMBNAIL_TARGETS = BAMBU_FAMILY;

/** The pixel sizes a target's thumbnail members must have. */
export function thumbnailSizes(target) {
  return BAMBU_FAMILY.includes(target)
    ? { main: 512, small: 128 }
    : { main: 256, small: null };
}

/**
 * Validate the rendered PNGs and describe the members, relationships and plate
 * metadata one export needs.
 *
 * @param {{target: string, thumbnails: {main: Uint8Array, small?: Uint8Array|null},
 *          plateName?: string, objectIds?: Array<string|number>,
 *          plateId?: number|string}} request
 * @returns {{members: Array<[string, Uint8Array]>, rels: Array<{id, type, target}>,
 *            plate: string|null, main: string, small: string|null}}
 */
export function thumbnailPlan(request) {
  const target = String(request.target);
  const sizes = thumbnailSizes(target);
  const thumbnails = request.thumbnails || {};
  const main = thumbnails.main;
  const small = thumbnails.small || null;
  if (!main || !main.length) {
    throw new Error("the output thumbnail was not rendered, so this file would be "
      + "saved without one");
  }
  assertPng(main, sizes.main, sizes.main, "the output thumbnail");
  if (sizes.small) {
    if (!small || !small.length) {
      throw new Error(`a ${target} project needs the ${sizes.small}px cover image `
        + "as well as the main thumbnail");
    }
    assertPng(small, sizes.small, sizes.small, "the small cover image");
  }

  const members = [];
  const rels = [];
  const plateId = request.plateId === undefined || request.plateId === null
    ? 1 : request.plateId;
  const plateName = request.plateName || "Plate 1";
  let plate = null;

  if (BAMBU_FAMILY.includes(target)) {
    members.push([THUMBNAIL_MAIN, main]);
    members.push([THUMBNAIL_SMALL, small]);
    rels.push({ id: "rel-thumb-1", type: REL_THUMBNAIL, target: THUMBNAIL_MAIN });
    rels.push({ id: "rel-thumb-2", type: REL_COVER_MIDDLE, target: THUMBNAIL_MAIN });
    rels.push({ id: "rel-thumb-3", type: REL_COVER_SMALL, target: THUMBNAIL_SMALL });
    // The plate metadata names the image the way the slicers show it in the
    // plate list; without it the cover relationships are the only pointer.
    plate = " <plate>\n"
      + `  <metadata key="plater_id" value="${plateId}"/>\n`
      + `  <metadata key="plater_name" value="${escapeXml(plateName)}"/>\n`
      + `  <metadata key="thumbnail_file" value="${THUMBNAIL_MAIN}"/>\n`
      + (request.objectIds || []).map((id) => "  <model_instance>\n"
        + `   <metadata key="object_id" value="${escapeXml(id)}"/>\n`
        + '   <metadata key="instance_id" value="0"/>\n'
        + "  </model_instance>\n").join("")
      + " </plate>";
    return { members, rels, plate, main: THUMBNAIL_MAIN, small: THUMBNAIL_SMALL };
  }

  members.push([PRUSA_THUMBNAIL, main]);
  rels.push({ id: "rel-thumb-1", type: REL_THUMBNAIL, target: PRUSA_THUMBNAIL });
  return { members, rels, plate: null, main: PRUSA_THUMBNAIL, small: null };
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The `<Relationship>` lines a plan adds, ready to append to `_rels/.rels`. */
export function relationshipXml(rels) {
  const ids = new Set();
  return rels.map((rel) => {
    if (ids.has(rel.id)) throw new Error(`two relationships share the id ${rel.id}`);
    ids.add(rel.id);
    return ` <Relationship Target="/${rel.target}" Id="${rel.id}" `
      + `Type="${rel.type}"/>`;
  });
}
