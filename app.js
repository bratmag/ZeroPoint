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

function renderFiles() {
  const fileList = document.querySelector("#fileList");
  const modelFiles = demoFiles.filter((file) => supportedExtensions.has(getExtension(file.name)));

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
  const selectedFiles = demoFiles.filter((file) => selectedIds.has(file.id));
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

  output.textContent = generated
    .map((file) => `${file.target}\n${file.content}\nLastes opp til: ${file.folder}`)
    .join("\n\n");
}

renderFiles();
document.querySelector("#generateButton").addEventListener("click", generateWorldFiles);
