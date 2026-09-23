import { readZip } from "../zip.js";
import { analyse, decode, planText } from "./planner.js";
import { buildSwapExport, inspectU1 } from "./swapExport.js";
self.onmessage = async ({data}) => {
  try {
    const {file, member, action} = data;
    if (file.size > 96 * 1024 * 1024) throw new Error("This file exceeds the 96 MB limit.");
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const entries = await readZip(bytes);
      const members = [...entries.keys()].filter((n)=>n.toLowerCase().endsWith(".gcode"));
      if (!members.length) throw new Error("This 3MF is not sliced. Slice it and export G-code first.");
      if (!member || !members.includes(member)) {
        if (members.length !== 1) { self.postMessage({members}); return; }
        bytes = entries.get(members[0]);
      } else bytes = entries.get(member);
    }
    const text = decode(bytes);
    if (action === "export") {
      const result = buildSwapExport(text, file.name);
      self.postMessage(result);
    } else {
      const evidence = /^;\s*printer_(?:model|settings_id)\s*=\s*Snapmaker U1/m.test(text)
        ? inspectU1(text).evidence : analyse(text, {physical:4});
      self.postMessage({evidence, sheet:planText(evidence,file.name,member)});
    }
  } catch (error) {
    if (error.evidence) self.postMessage({evidence: error.evidence, sheet: planText(error.evidence, data.file.name, data.member)});
    else self.postMessage({error:error.message});
  }
};
