exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    const body = safeJsonParse(event.body) || {};

    if (body.action === "listModelFiles") {
      return jsonResponse(200, await handleListModelFiles(body));
    }

    if (body.action === "uploadWorldFile") {
      return jsonResponse(200, await handleUploadWorldFile(body));
    }

    return jsonResponse(400, { ok: false, error: `Unknown action: ${String(body.action)}` });
  } catch (err) {
    console.error("tc-proxy fatal:", err);
    return jsonResponse(500, { ok: false, error: err?.message || String(err) });
  }
};

const modelExtensionPattern = /\.(ifc|trb|dwg)$/i;

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(data, null, 2),
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shortText(text, max = 800) {
  if (typeof text !== "string") return text;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isUploadAlreadyCompleted(responseText) {
  return /file upload already completed/i.test(String(responseText || ""));
}

let regionCache = null;

async function discoverRegions() {
  if (regionCache) return regionCache;

  try {
    const res = await fetch("https://app.connect.trimble.com/tc/api/2.0/regions");
    if (res.ok) {
      regionCache = await res.json();
      return regionCache;
    }
  } catch (err) {
    console.error("discoverRegions failed:", err?.message || String(err));
  }

  return null;
}

function getFallbackCoreBaseUrl(projectLocation) {
  const loc = String(projectLocation || "").toLowerCase();

  if (loc === "europe") return "https://app21.connect.trimble.com/tc/api/2.0";
  if (loc === "asia") return "https://app.asia.connect.trimble.com/tc/api/2.0";

  return "https://app.connect.trimble.com/tc/api/2.0";
}

async function getCoreBaseUrl(projectLocation) {
  const loc = String(projectLocation || "").toLowerCase();
  const regions = await discoverRegions();

  if (regions && Array.isArray(regions)) {
    const match = regions.find((region) => {
      const id = String(region.id || region.name || region.location || "").toLowerCase();
      return id === loc || id.includes(loc);
    });

    const raw =
      match?.["tc-api"] ||
      match?.tcApi ||
      match?.tc_api ||
      match?.origin ||
      match?.api ||
      match?.apiOrigin ||
      match?.baseUrl ||
      match?.url;

    if (raw) {
      const withProtocol = String(raw).startsWith("//") ? `https:${raw}` : String(raw);
      const base = withProtocol.replace(/\/+$/, "");
      return base.endsWith("/tc/api/2.0") ? base : `${base}/tc/api/2.0`;
    }
  }

  return getFallbackCoreBaseUrl(projectLocation);
}

async function fetchJsonWithBearer(url, token) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  return {
    url,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    contentType,
    text,
    json: safeJsonParse(text),
  };
}

async function fetchWithBearer(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  return {
    url,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    contentType,
    text,
    json: safeJsonParse(text),
  };
}

async function handleUploadWorldFile(body) {
  const { token, projectId, projectLocation, parentId, fileName, text } = body;

  if (!token || !projectId || !parentId || !fileName || typeof text !== "string") {
    return {
      ok: false,
      error: "Mangler token, projectId, parentId, fileName eller text",
    };
  }

  const base = await getCoreBaseUrl(projectLocation);
  const fileBuffer = Buffer.from(text, "utf8");
  const attempts = [];
  const initUrl = `${base}/files/fs/upload?parentId=${encodeURIComponent(parentId)}&parentType=FOLDER`;
  const init = await fetchWithBearer(initUrl, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: fileName }),
  });
  attempts.push({
    mode: "signed-init",
    url: initUrl,
    ok: init.ok,
    status: init.status,
    preview: shortText(init.text, 500),
  });

  if (!init.ok || !init.json) {
    return {
      ok: false,
      action: "uploadWorldFile",
      error: "Kunne ikke starte signed upload.",
      project: { id: projectId, location: projectLocation },
      upload: {
        parentId,
        fileName,
        size: fileBuffer.length,
      },
      attempts,
    };
  }

  const uploadId = init.json.uploadId || init.json.id || init.json.data?.uploadId || init.json.result?.uploadId;
  const uploadUrl =
    init.json.contents?.[0]?.url ||
    init.json.data?.contents?.[0]?.url ||
    init.json.result?.contents?.[0]?.url ||
    init.json.uploadUrl ||
    init.json.url;

  if (!uploadId || !uploadUrl) {
    return {
      ok: false,
      action: "uploadWorldFile",
      error: "Signed upload manglet uploadId eller uploadUrl.",
      project: { id: projectId, location: projectLocation },
      upload: {
        parentId,
        fileName,
        size: fileBuffer.length,
      },
      attempts,
    };
  }

  const upload = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(fileBuffer),
  });
  const uploadText = await upload.text();
  attempts.push({
    mode: "signed-put",
    url: uploadUrl,
    ok: upload.ok,
    status: upload.status,
    preview: shortText(uploadText, 500),
  });

  if (!upload.ok) {
    return {
      ok: false,
      action: "uploadWorldFile",
      error: "Kunne ikke skrive filinnhold til signed upload URL.",
      project: { id: projectId, location: projectLocation },
      upload: {
        parentId,
        fileName,
        size: fileBuffer.length,
      },
      attempts,
    };
  }

  const completeUrl = `${base}/files/fs/upload/${encodeURIComponent(uploadId)}/complete`;
  const complete = await fetchWithBearer(completeUrl, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ format: "SINGLE_PART" }),
  });
  attempts.push({
    mode: "signed-complete",
    url: completeUrl,
    ok: complete.ok,
    status: complete.status,
    preview: shortText(complete.text, 500),
  });

  if (complete.ok || isUploadAlreadyCompleted(complete.text)) {
    return {
      ok: true,
      action: "uploadWorldFile",
      project: { id: projectId, location: projectLocation },
      upload: {
        mode: "signed-upload",
        parentId,
        fileName,
        uploadId,
        size: fileBuffer.length,
        alreadyCompleted: !complete.ok,
      },
      response: complete.json || complete.text,
      attempts,
    };
  }

  return {
    ok: false,
    action: "uploadWorldFile",
    error: "Kunne ikke fullføre signed upload.",
    project: { id: projectId, location: projectLocation },
    upload: {
      parentId,
      uploadId,
      fileName,
      size: fileBuffer.length,
    },
    attempts,
  };
}

async function handleListModelFiles(body) {
  const { token, projectId, projectLocation, rootFolderId } = body;

  if (!token || !projectId) {
    return { ok: false, error: "Mangler token eller projectId" };
  }

  const base = await getCoreBaseUrl(projectLocation);
  const diagnostics = [];
  const filesByKey = new Map();
  const seedFolderIds = new Set();

  if (rootFolderId) seedFolderIds.add(String(rootFolderId));

  for (const extension of ["ifc", "trb", "dwg"]) {
    const url = `${base}/search?projectId=${encodeURIComponent(projectId)}&query=.${extension}&type=file`;
    const res = await fetchJsonWithBearer(url, token);
    diagnostics.push({
      name: `search-${extension}`,
      url,
      ok: res.ok,
      status: res.status,
      preview: shortText(res.text),
    });

    if (!res.ok || !res.json) continue;

    for (const file of normalizeFilesFromAnyResponse(res.json).filter(isModelFile)) {
      addFile(filesByKey, file);
      if (file.parentId) seedFolderIds.add(file.parentId);
    }
  }

  const folderResult = await traverseFolders({
    base,
    token,
    seedFolderIds: Array.from(seedFolderIds),
    diagnostics,
  });

  for (const file of folderResult.files) {
    addFile(filesByKey, file);
  }

  const fallbackCandidates = [
    {
      name: "projects-files-recursive",
      url: `${base}/projects/${encodeURIComponent(projectId)}/files?recursive=true`,
    },
    {
      name: "projects-files",
      url: `${base}/projects/${encodeURIComponent(projectId)}/files`,
    },
  ];

  for (const candidate of fallbackCandidates) {
    const res = await fetchJsonWithBearer(candidate.url, token);
    diagnostics.push({
      name: candidate.name,
      url: candidate.url,
      ok: res.ok,
      status: res.status,
      preview: shortText(res.text),
    });

    if (!res.ok || !res.json) continue;

    for (const file of normalizeFilesFromAnyResponse(res.json).filter(isModelFile)) {
      addFile(filesByKey, file);
    }
  }

  const files = Array.from(filesByKey.values()).sort((a, b) =>
    String(a.path || a.folder || "").localeCompare(String(b.path || b.folder || ""), undefined, { sensitivity: "base" }) ||
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }),
  );

  return {
    ok: true,
    action: "listModelFiles",
    project: { id: projectId, location: projectLocation },
    resolvedBaseUrl: base,
    fileCount: files.length,
    files,
    diagnostics,
  };
}

async function traverseFolders({ base, token, seedFolderIds, diagnostics }) {
  const filesByKey = new Map();
  const folderQueue = seedFolderIds.map((id) => ({ id, pathParts: [] }));
  const visitedFolders = new Set();

  while (folderQueue.length) {
    const current = folderQueue.shift();
    if (!current?.id || visitedFolders.has(current.id)) continue;
    visitedFolders.add(current.id);

    const variants = [
      {
        name: "folders-items",
        url: `${base}/folders/${encodeURIComponent(current.id)}/items`,
      },
      {
        name: "folders-items-recursive",
        url: `${base}/folders/${encodeURIComponent(current.id)}/items?recursive=true`,
      },
    ];

    let currentItems = [];

    for (const variant of variants) {
      const res = await fetchJsonWithBearer(variant.url, token);
      diagnostics.push({
        name: `${variant.name}:${current.id}`,
        url: variant.url,
        ok: res.ok,
        status: res.status,
        preview: shortText(res.text),
      });

      if (!res.ok || !res.json) continue;

      currentItems = normalizeItemsFromAnyResponse(res.json, current.pathParts);
      if (currentItems.length) break;
    }

    for (const item of currentItems) {
      if (item.kind === "folder") {
        folderQueue.push({
          id: item.id,
          pathParts: item.name ? [...current.pathParts, item.name] : current.pathParts,
        });
        continue;
      }

      if (isModelFile(item)) {
        addFile(filesByKey, item);
      }
    }
  }

  return { files: Array.from(filesByKey.values()) };
}

function addFile(filesByKey, file) {
  const key = `${file.id}|${file.parentId || ""}|${file.name}`;
  if (!filesByKey.has(key)) {
    filesByKey.set(key, file);
  }
}

function isModelFile(file) {
  return !!(file?.id && file?.name && modelExtensionPattern.test(file.name));
}

function normalizePathValue(pathValue) {
  if (!pathValue) return "";
  if (typeof pathValue === "string") return pathValue;

  if (Array.isArray(pathValue)) {
    return pathValue
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        if (typeof item === "object") return item.name || item.title || item.id || "";
        return "";
      })
      .filter(Boolean)
      .join("/");
  }

  if (typeof pathValue === "object") {
    return pathValue.name || pathValue.title || pathValue.id || "";
  }

  return String(pathValue);
}

function normalizeFilesFromAnyResponse(payload) {
  const out = [];
  const seen = new Set();
  walkAny(payload, [], out, seen);
  return out;
}

function normalizeItemsFromAnyResponse(payload, basePathParts = []) {
  const out = [];
  const seen = new Set();
  walkAnyItem(payload, basePathParts, out, seen);
  return out;
}

function walkAny(node, pathParts, out, seen) {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) walkAny(item, pathParts, out, seen);
    return;
  }

  if (typeof node !== "object") return;

  const details = node.details && typeof node.details === "object" ? node.details : null;
  const effectiveName = node.name || node.fileName || node.filename || node.title || details?.name || details?.fileName || null;
  const effectiveId = node.id || node.fileId || node.versionId || details?.id || details?.fileId || null;
  const effectiveParentId = node.parentId || node.parent?.id || details?.parentId || null;
  const effectiveVersionId = node.versionId || details?.versionId || null;
  const effectiveModifiedOn =
    node.modifiedOn ||
    node.modifiedAt ||
    node.updatedOn ||
    node.lastModifiedOn ||
    node.lastModified ||
    details?.modifiedOn ||
    details?.modifiedAt ||
    details?.updatedOn ||
    details?.lastModifiedOn ||
    details?.lastModified ||
    null;
  const effectivePath = node.path || node.folderPath || node.fullPath || node.location || details?.path || null;
  const childPath = effectiveName ? [...pathParts, effectiveName] : pathParts;

  if (effectiveId && effectiveName) {
    const normalized = {
      id: String(effectiveId),
      name: String(effectiveName),
      versionId: effectiveVersionId ? String(effectiveVersionId) : null,
      modifiedOn: effectiveModifiedOn ? String(effectiveModifiedOn) : null,
      parentId: effectiveParentId ? String(effectiveParentId) : null,
      path: effectivePath ? normalizePathValue(effectivePath) : buildPath(pathParts),
      folder: effectivePath ? normalizePathValue(effectivePath) : buildPath(pathParts),
    };

    const key = `${normalized.id}|${normalized.name}|${normalized.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (["parent", "parents", "_links", "links", "permissions"].includes(key)) continue;
    if (Array.isArray(value) || (value && typeof value === "object")) {
      walkAny(value, childPath, out, seen);
    }
  }
}

function walkAnyItem(node, pathParts, out, seen) {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) walkAnyItem(item, pathParts, out, seen);
    return;
  }

  if (typeof node !== "object") return;

  const details = node.details && typeof node.details === "object" ? node.details : null;
  const effectiveName = node.name || node.fileName || node.filename || node.title || details?.name || details?.fileName || null;
  const effectiveId = node.id || node.fileId || node.versionId || details?.id || details?.fileId || null;
  const rawType = node.type || node.itemType || node.kind || node.objectType || node.resourceType || details?.type || details?.itemType || null;
  const effectiveParentId = node.parentId || node.parent?.id || details?.parentId || null;
  const effectiveVersionId = node.versionId || details?.versionId || null;
  const effectiveModifiedOn =
    node.modifiedOn ||
    node.modifiedAt ||
    node.updatedOn ||
    node.lastModifiedOn ||
    node.lastModified ||
    details?.modifiedOn ||
    details?.modifiedAt ||
    details?.updatedOn ||
    details?.lastModifiedOn ||
    details?.lastModified ||
    null;
  const effectivePath = node.path || node.folderPath || node.fullPath || node.location || details?.path || null;
  const normalizedKind = normalizeItemKind(rawType, node, details);
  const childPath = effectiveName ? [...pathParts, effectiveName] : pathParts;

  if (effectiveId && effectiveName && normalizedKind) {
    const normalized = {
      id: String(effectiveId),
      name: String(effectiveName),
      kind: normalizedKind,
      versionId: effectiveVersionId ? String(effectiveVersionId) : null,
      modifiedOn: effectiveModifiedOn ? String(effectiveModifiedOn) : null,
      parentId: effectiveParentId ? String(effectiveParentId) : null,
      path: effectivePath ? normalizePathValue(effectivePath) : buildPath(pathParts),
      folder: effectivePath ? normalizePathValue(effectivePath) : buildPath(pathParts),
    };

    const key = `${normalized.id}|${normalized.kind}|${normalized.name}|${normalized.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (["parent", "parents", "_links", "links", "permissions"].includes(key)) continue;
    if (Array.isArray(value) || (value && typeof value === "object")) {
      walkAnyItem(value, childPath, out, seen);
    }
  }
}

function normalizeItemKind(rawType, node, details) {
  const value = String(rawType || "").toLowerCase();

  if (value.includes("folder") || value === "dir" || value === "directory" || value === "container") {
    return "folder";
  }

  if (value.includes("file") || value.includes("document") || value.includes("version")) {
    return "file";
  }

  if (node?.hasChildren || details?.hasChildren) return "folder";
  if (node?.children || details?.children) return "folder";
  if (node?.size != null || details?.size != null) return "file";

  return null;
}

function buildPath(parts) {
  const pathParts = (parts || []).filter(Boolean).map((part) => String(part).trim()).filter(Boolean);
  return pathParts.length ? pathParts.join("/") : "";
}
