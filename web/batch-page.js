import { BatchSession, MAX_BATCH_FILES } from "./shared/batchSession.js";
import { RecolourWorker } from "./shared/workerClient.js";

export function initBatch() {
  const $ = id => document.getElementById(id);
  let files = [], rows = [], outputUrl = null;
  const say = text => { $("batchstatus").textContent = text; };
  const release = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
    $("batchout").replaceChildren();
  };
  const engine = new BatchSession(() => new RecolourWorker(),
    () => new RecolourWorker(new URL("./shared/batchZipWorker.js", import.meta.url)), {
      status: say,
      row: (index, state) => {
        rows[index].status.textContent = state.status[0].toUpperCase() + state.status.slice(1);
        rows[index].detail.textContent = state.detail;
        rows[index].item.dataset.status = state.status;
      },
      progress: value => { $("batchprogress").value = value; },
      packing: () => { $("batchcancel").disabled = true; },
    });

  function setMode(bulk) {
    if (engine.busy) return;
    $("singlepanel").classList.toggle("hidden", bulk);
    $("batchpanel").classList.toggle("hidden", !bulk);
    $("mode-single").setAttribute("aria-pressed", String(!bulk));
    $("mode-bulk").setAttribute("aria-pressed", String(bulk));
  }
  function controls(running) {
    for (const id of ["batchfile", "batchtarget", "batchsettings", "batchclear", "mode-single", "mode-bulk"]) $(id).disabled = running;
    $("batchdrop").setAttribute("aria-disabled", String(running));
    $("batchdrop").tabIndex = running ? -1 : 0;
    $("batchgo").disabled = running || !files.length;
    $("batchcancel").classList.toggle("hidden", !running);
    $("batchcancel").disabled = false;
    rows.forEach(r => { r.remove.disabled = running; });
  }
  function render() {
    $("batchgo").classList.add("primary");
    $("batchgo").textContent = "Convert files";
    $("batchqueue").replaceChildren();
    rows = files.map((file, index) => {
      const item = document.createElement("li");
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = file.name;
      const detail = document.createElement("span");
      detail.className = "hint batchdetail";
      detail.textContent = `${(file.size / 1048576).toFixed(1)} MB`;
      info.append(name, detail);
      const status = document.createElement("span");
      status.className = "batchstate";
      status.textContent = "Queued";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        files.splice(index, 1); release(); render();
        say(files.length ? `${files.length} files ready.` : "Add files to start a batch.");
        (rows[Math.min(index, rows.length - 1)]?.remove || $("batchdrop")).focus();
      });
      item.append(info, status, remove);
      $("batchqueue").append(item);
      return { item, status, detail, remove };
    });
    $("batchcount").textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} in batch` : "No files added yet";
    $("batchclear").classList.toggle("hidden", !files.length);
    $("batchprogress").classList.add("hidden");
    controls(false);
  }
  function addFiles(incoming) {
    if (engine.busy) return;
    setMode(true);
    const list = Array.from(incoming);
    const available = MAX_BATCH_FILES - files.length;
    files.push(...list.slice(0, available));
    release(); render();
    say(list.length > available ? `Added ${available} files. The batch limit is 50; ${list.length - available} were not added.`
      : `${files.length} files ready. Choose a format, then convert.`);
    $("batchdrop").focus();
  }
  $("mode-single").addEventListener("click", () => setMode(false));
  $("mode-bulk").addEventListener("click", () => setMode(true));
  $("batchfile").addEventListener("click", event => event.stopPropagation());
  $("batchfile").addEventListener("change", () => {
    addFiles($("batchfile").files);
    $("batchfile").value = "";
  });
  $("batchdrop").addEventListener("click", () => { if (!engine.busy) $("batchfile").click(); });
  $("batchdrop").addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!engine.busy) $("batchfile").click(); }
  });
  for (const type of ["dragenter", "dragover"]) $("batchdrop").addEventListener(type, event => {
    event.preventDefault(); if (!engine.busy) $("batchdrop").classList.add("over");
  });
  $("batchdrop").addEventListener("dragleave", () => $("batchdrop").classList.remove("over"));
  $("batchdrop").addEventListener("drop", event => {
    event.preventDefault(); event.stopPropagation();
    $("batchdrop").classList.remove("over"); addFiles(event.dataTransfer.files);
  });
  $("batchclear").addEventListener("click", () => {
    files = []; release(); render(); say("Add files to start a batch.");
    $("batchdrop").focus();
  });
  for (const id of ["batchtarget", "batchsettings"]) $(id).addEventListener("change", () => {
    release(); render(); say("Options updated. Convert to create a new ZIP.");
  });
  $("batchcancel").addEventListener("click", () => {
    engine.cancel(); $("batchcancel").disabled = true;
    say("Stopping. Completed outputs will be kept in the ZIP.");
  });
  $("batchgo").addEventListener("click", async () => {
    if (engine.busy || !files.length) return;
    release(); render(); controls(true);
    $("batchprogress").classList.remove("hidden");
    $("batchprogress").max = files.length;
    $("batchprogress").value = 0;
    try {
      const result = await engine.run(files, { target: $("batchtarget").value, keepSettings: $("batchsettings").checked });
      if (!result) return;
      const { report } = result;
      outputUrl = URL.createObjectURL(new Blob([result.bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.className = "save";
      link.href = outputUrl;
      link.download = result.name;
      link.textContent = report.outputs ? `Download ZIP · ${report.outputs} converted file${report.outputs === 1 ? "" : "s"}` : "Download report ZIP";
      const failures = report.entries.filter(e => e.status === "failed").length;
      $("batchout").append(link);
      say(`${report.cancelled ? "Stopped" : "Finished"}: ${report.outputs} converted output${report.outputs === 1 ? "" : "s"}, ${failures} failure${failures === 1 ? "" : "s"}. The ZIP includes a readable report and full settings details.`);
      $("batchgo").classList.remove("primary");
      $("batchgo").textContent = "Convert again";
      $("batchprogress").value = files.length;
      link.click();
      link.focus();
    } catch (error) { say(`The ZIP could not be created: ${error.message}. Try fewer files.`); }
    finally { controls(false); }
  });
  window.addEventListener("pagehide", () => { engine.close(); release(); });
  render();
  return { addFiles };
}
