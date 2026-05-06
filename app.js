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
      icon: "https://zeropoint3dmodel.netlify.app/icon.svg",
      subMenus: [
        {
          title: "Georeferer",
          command: "zeropoint_home",
        },
      ],
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

function generateWorldFiles() {
  const selectedIds = new Set(
    [...document.querySelectorAll('#fileList input[type="checkbox"]:checked')].map((input) => input.value),
  );
  const selectedFiles = files.filter((file) => selectedIds.has(file.id));
  const output = document.querySelector("#output");

  if (selectedFiles.length === 0) {
    output.textContent = "Ingen modeller valgt.";
    return;
  }

  const content = buildWorldContent(getCoordinateValues());
  const generated = selectedFiles.map((file) => ({
    source: file.name,
    target: getWorldFilename(file.name),
    folder: file.folder || file.path || "Rotmappe",
    content,
  }));

  const uploadStatus = accessToken
    ? "Klar for opplasting via Trimble Connect Core API."
    : "Demo: opplasting er ikke aktiv før appen er installert i Trimble Connect.";

  output.textContent = generated
    .map((file) => `${file.target}\n${file.content}\nLastes opp til: ${file.folder}`)
    .join("\n\n")
    .concat(`\n\n${uploadStatus}`);
}

async function start() {
  await connectToTrimbleConnect();
  await loadProjectFiles();
}

document.querySelector("#generateButton").addEventListener("click", generateWorldFiles);
start();
