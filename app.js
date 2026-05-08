const supportedExtensions = new Map([
  [".ifc", ".ifcw"],
  [".trb", ".trbw"],
  [".dwg", ".dwgw"],
]);

const demoFiles = [
  { id: "1", name: "SLMS_RIVA.ifc", folder: "08 IFC" },
  { id: "2", name: "Parkeringskjeller.trb", folder: "02 Modell" },
  { id: "3", name: "Situasjonsplan.dwg", folder: "01 Underlag" },
  { id: "4", name: "Notat.pdf", folder: "Dokumenter" },
];

let workspaceApi = null;
let accessToken = null;
let project = null;
let files = [];

function getExtension(filename) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function getWorldFilename(filename) {
  const extension = getExtension(filename);
  const worldExtension = supportedExtensions.get(extension);

  if (!worldExtension) {
    return null;
  }

  return `${filename.slice(0, -extension.length)}${worldExtension}`;
}

function formatCoordinate(value) {
  return Number(value).toFixed(3);
}

function buildWorldContent(values) {
  return [
    formatCoordinate(values.localEast),
    formatCoordinate(values.localNorth),
    formatCoordinate(values.absoluteEast),
    formatCoordinate(values.absoluteNorth),
  ].join(", ");
}

function getCoordinateValues() {
  return {
    localEast: document.querySelector("#localEast").value,
    localNorth: document.querySelector("#localNorth").value,
    absoluteEast: document.querySelector("#absoluteEast").value,
    absoluteNorth: document.querySelector("#absoluteNorth").value,
  };
}

function setStatus(message) {
  document.querySelector("#connectionStatus").textContent = message;
}

function setResult(message, type = "neutral") {
  const resultMessage = document.querySelector("#resultMessage");
  resultMessage.className = `result-message ${type}`;
  resultMessage.innerHTML = message;
}

function setLog(message, show = false) {
  const output = document.querySelector("#output");
  const details = document.querySelector("#logDetails");
  output.textContent = message || "";
  details.hidden = !show;
  if (!show) details.open = false;
}

function successIcon() {
  return '<span class="success-mark">✓</span>';
}

function getProjectRootFolderId(connectProject) {
  return (
    connectProject?.rootFolderId ||
    connectProject?.rootFolderIdentifier ||
    connectProject?.rootId ||
    connectProject?.root?.id ||
    connectProject?.details?.rootFolderId ||
    null
  );
}

async function callProxy(action, payload) {
  const response = await fetch("/.netlify/functions/tc-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

async function loadProjectFiles() {
  if (!project?.id || !accessToken) {
    return;
  }

  setStatus(`Henter modeller fra prosjekt: ${project.name ?? project.id}...`);

  const result = await callProxy("listModelFiles", {
    token: accessToken,
    projectId: project.id,
    projectLocation: project.location,
    rootFolderId: getProjectRootFolderId(project),
  });

  if (!result.ok || !result.json?.ok) {
    console.error("listModelFiles failed", result);
    files = [];
    renderFiles();
    setStatus("Kunne ikke hente modeller fra prosjektet.");
    return;
  }

  files = Array.isArray(result.json.files) ? result.json.files : [];
  renderFiles();
  setStatus(`Koblet til prosjekt: ${project.name ?? project.id}. Fant ${files.length} modellfil${files.length === 1 ? "" : "er"}.`);
}

async function connectToTrimbleConnect() {
  if (window.parent === window) {
    files = demoFiles;
    renderFiles();
    setStatus("Demo-modus: åpne appen som Trimble Connect extension for prosjektdata.");
    return;
  }

  if (!window.TrimbleConnectWorkspace?.connect) {
    setStatus("Trimble Connect Workspace API ble ikke lastet.");
    return;
  }

  try {
    workspaceApi = await window.TrimbleConnectWorkspace.connect(
      window.parent,
      (event, args) => {
        if (event === "extension.accessToken") {
          accessToken = args?.data ?? args;
          setStatus("Koblet til Trimble Connect med tilgangstoken.");
        }
      },
      30000,
    );

    await workspaceApi.ui?.setMenu?.({
      title: "ZeroPoint",
      command: "zeropoint_home",
      icon: "https://zeropoint3dmodel.netlify.app/zeropoint-logo.png",
    });

    project = await workspaceApi.project.getProject();
    const permissionResult = await workspaceApi.extension.requestPermission("accesstoken");

    if (permissionResult && permissionResult !== "pending") {
      accessToken = permissionResult;
    }

    setStatus(`Koblet til prosjekt: ${project.name ?? project.id ?? "ukjent prosjekt"}.`);
  } catch (error) {
    console.error(error);
    files = demoFiles;
    renderFiles();
    setStatus("Kunne ikke koble til Trimble Connect. Kjører videre i demo-modus.");
  }
}

function renderFiles() {
  const fileList = document.querySelector("#fileList");
  const modelFiles = files.filter((file) => supportedExtensions.has(getExtension(file.name)));

  fileList.innerHTML = "";

  if (modelFiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Ingen IFC-, TRB- eller DWG-filer funnet.";
    fileList.append(empty);
    return;
  }

  for (const file of modelFiles) {
    const row = document.createElement("label");
    row.className = "file-row";
    const folder = file.folder || file.path || "Rotmappe";
    row.innerHTML = `
      <input type="checkbox" value="${file.id}">
      <span>${file.name}</span>
      <span>(${folder})</span>
    `;
    fileList.append(row);
  }
}

async function uploadWorldFile(generatedFile) {
  if (!project?.id || !accessToken) {
    return {
      ok: false,
      error: "Mangler prosjektkobling eller access token.",
    };
  }

  if (!generatedFile.parentId) {
    return {
      ok: false,
      error: "Mangler mappe-ID for originalfilen.",
    };
  }

  const result = await callProxy("uploadWorldFile", {
    token: accessToken,
    projectId: project.id,
    projectLocation: project.location,
    parentId: generatedFile.parentId,
    fileName: generatedFile.target,
    text: generatedFile.content,
  });

  if (!result.ok || !result.json?.ok) {
    console.error("uploadWorldFile failed", result);
    return {
      ok: false,
      error: result.json?.error || `HTTP ${result.status}`,
      details: result.json || result.text,
    };
  }

  return {
    ok: true,
    details: result.json,
  };
}

async function generateWorldFiles() {
  const selectedIds = new Set(
    [...document.querySelectorAll('#fileList input[type="checkbox"]:checked')].map((input) => input.value),
  );
  const selectedFiles = files.filter((file) => selectedIds.has(file.id));

  if (selectedFiles.length === 0) {
    setResult("Ingen modeller valgt.", "error");
    setLog("", false);
    return;
  }

  const content = buildWorldContent(getCoordinateValues());
  const generated = selectedFiles.map((file) => ({
    source: file.name,
    target: getWorldFilename(file.name),
    folder: file.folder || file.path || "Rotmappe",
    parentId: file.parentId,
    content,
  }));

  const generatedLog = generated
    .map((file) => `${file.target}\n${file.content}\nLastes opp til: ${file.folder}`)
    .join("\n\n");
  setLog(generatedLog, false);

  if (!accessToken || !project?.id) {
    setResult("Demo: opplasting er ikke aktiv før appen er installert i Trimble Connect.", "neutral");
    setLog(`${generatedLog}\n\nDemo: opplasting er ikke aktiv før appen er installert i Trimble Connect.`, true);
    return;
  }

  setResult("Laster opp world-filer til Trimble Connect...", "working");
  setLog(`${generatedLog}\n\nLaster opp...`, false);
  const results = [];

  for (const generatedFile of generated) {
    const result = await uploadWorldFile(generatedFile);
    results.push({
      fileName: generatedFile.target,
      ...result,
    });
  }

  const okCount = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);

  if (failed.length === 0) {
    const values = getCoordinateValues();
    const coordinateText = `Lokalt nullpunkt ${formatCoordinate(values.localEast)}, ${formatCoordinate(values.localNorth)} -> absolutt nullpunkt ${formatCoordinate(values.absoluteEast)}, ${formatCoordinate(values.absoluteNorth)}.`;
    setResult(`${successIcon()}${okCount} world-fil${okCount === 1 ? "" : "er"} lastet opp til Trimble Connect.<br>${coordinateText}`, "success");
    setLog(`${generatedLog}\n\nFerdig: ${okCount} world-fil${okCount === 1 ? "" : "er"} lastet opp til Trimble Connect.`, false);
    setStatus(`Ferdig: ${okCount} world-fil${okCount === 1 ? "" : "er"} lastet opp.`);
    return;
  }

  const errorLog = `${generatedLog}\n\n${okCount} lastet opp, ${failed.length} feilet:\n${failed
    .map((result) => {
      const attempts = Array.isArray(result.details?.attempts)
        ? result.details.attempts
          .map((attempt) => `${attempt.mode}: HTTP ${attempt.status}${attempt.preview ? ` (${attempt.preview})` : ""}`)
          .join("\n")
        : "";
      return `${result.fileName}: ${result.error}${attempts ? `\n${attempts}` : ""}`;
    })
    .join("\n")}`;
  setResult(`${okCount} lastet opp, ${failed.length} feilet. Åpne teknisk logg for detaljer.`, "error");
  setLog(errorLog, true);
  setStatus("Noen world-filer kunne ikke lastes opp.");
}

async function start() {
  await connectToTrimbleConnect();
  await loadProjectFiles();
}

document.querySelector("#generateButton").addEventListener("click", generateWorldFiles);
start();
