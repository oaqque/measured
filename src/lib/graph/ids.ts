export function createGraphDocumentNodeId(sourcePath: string) {
  return `doc:${sourcePath}`;
}

export function createGraphFolderNodeId(folderPath: string) {
  return `folder:${folderPath}`;
}

export function graphFolderNodeIdToPath(nodeId: string) {
  return nodeId.startsWith("folder:") ? nodeId.slice("folder:".length) : null;
}

export function normalizeGraphHref(href: string) {
  let normalizedHref = href.split("#")[0]?.split("?")[0] ?? href;

  while (normalizedHref.startsWith("./")) {
    normalizedHref = normalizedHref.slice(2);
  }

  while (normalizedHref.startsWith("../")) {
    normalizedHref = normalizedHref.slice(3);
  }

  return normalizedHref;
}

export function workoutHrefToSlug(href: string) {
  const normalizedHref = normalizeGraphHref(href);
  if (normalizedHref.startsWith("/notes/")) {
    const slug = decodeURIComponent(normalizedHref.slice("/notes/".length)).trim();
    return slug.length > 0 ? slug : null;
  }

  if (!normalizedHref.startsWith("notes/") || !normalizedHref.endsWith(".md")) {
    return null;
  }

  const fileName = decodeURIComponent(normalizedHref.slice("notes/".length));
  return fileName
    .replace(/\.md$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
