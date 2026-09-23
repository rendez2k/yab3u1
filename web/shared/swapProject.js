// A separate slice-only project; never changes the normal U1 converter.
import { convertProject, SRC_BBL_PROJECT } from "./project.js";
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function prepareSwapProject(project, plateId, objects, thumbnails = null) {
  const count = Math.max(project.paletteCount, project.colors.length);
  if (count < 1 || count > 12) throw new Error("Reel-change preparation supports 1–12 source colours.");
  if (project.types.some((t) => String(t).toUpperCase() !== "PLA"))
    throw new Error("Reel-change preparation currently supports all-PLA models only.");
  const built = convertProject(project, plateId, objects, {
    target: "snapmaker", carrySettings: true, supportMode: "auto", thumbnails,
  });
  if (built.problems.length) throw new Error(built.problems[0]);
  const cfg = JSON.parse(decoder.decode(built.entries.get(SRC_BBL_PROJECT)));
  const machineKeys = [];
  const set = (key, value) => { cfg[key] = value; machineKeys.push(key); };
  // These are logical slicer extruders, not extra physical U1 toolheads.
  set("printer_extruder_id", Array.from({length: count}, (_,i) => String(i+1)));
  set("printer_extruder_variant", Array(count).fill("Direct Drive Standard"));
  for (const key of ["nozzle_diameter", "extruder_offset", "extruder_colour",
    "retract_before_wipe", "retract_length_toolchange", "retract_restart_extra_toolchange",
    "wipe", "wipe_distance", "min_layer_height", "max_layer_height"]) {
    const value = cfg[key];
    if (Array.isArray(value) && value.length) set(key, Array.from({length: count},(_,i)=>value[Math.min(i,value.length-1)]));
  }
  set("use_relative_e_distances", "1");
  set("printer_model", "Snapmaker U1");
  set("gcode_flavor", "klipper");
  // Clearly label the virtual slice: only the postprocessed output is for printing.
  set("machine_start_gcode", ";YAB3D_VIRTUAL_SLICE_ONLY\n" + cfg.machine_start_gcode);
  cfg.printer_settings_id = `YAB3D U1 ${count} colours - SLICE ONLY`;
  cfg.different_settings_to_system[count + 1] = machineKeys.sort().join(";");
  built.entries.set(SRC_BBL_PROJECT, encoder.encode(JSON.stringify(cfg, null, 2)));
  return built;
}
