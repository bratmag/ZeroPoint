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
let files = demoFiles;

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

async function connectToTrimbleConnect() {
  if (window.parent === window) {
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
    setStatus("Kunne ikke koble til Trimble Connect. Kjører videre i demo-modus.");
  }
}

function renderFiles() {
  const fileList = document.querySelector("#fileList");
  const modelFiles = files.filter((file) => supportedExtensions.has(getExtension(file.name)));

  fileList.innerHTML = "";

  for (const file of modelFiles) {
    const row = document.createElement("label");
    row.className = "file-row";
    row.innerHTML = `
      <input type="checkbox" value="${file.id}">
      <span>${file.name}</span>
      <span>(${file.folder})</span>
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
    folder: file.folder,
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
  renderFiles();
  await connectToTrimbleConnect();
}

document.querySelector("#generateButton").addEventListener("click", generateWorldFiles);
start();
