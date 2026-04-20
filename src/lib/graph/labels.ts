const TOP_LEVEL_DOCUMENT_LABELS = new Map<string, string>([
  ["WELCOME.md", "Welcome"],
  ["GOALS.md", "Goals"],
  ["PLAN.md", "Training Plan"],
  ["HEART_RATE.md", "Heart Rate"],
  ["MORNING_MOBILITY.md", "Morning Mobility"],
]);

const FOLDER_LABELS = new Map<string, string>([
  ["notes", "Workout Notes"],
  ["goals", "Goals"],
  ["metaanalysis", "Metaanalysis"],
  ["changelog", "Changelog"],
]);

export function formatGraphFolderLabel(folderPath: string) {
  return folderPath
    .split("/")
    .filter(Boolean)
    .map((segment) => FOLDER_LABELS.get(segment) ?? formatGraphSegmentLabel(segment))
    .join(" / ");
}

export function formatGraphSourcePathLabel(sourcePath: string) {
  if (TOP_LEVEL_DOCUMENT_LABELS.has(sourcePath)) {
    return TOP_LEVEL_DOCUMENT_LABELS.get(sourcePath) as string;
  }

  const parts = sourcePath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return sourcePath;
  }

  const fileName = parts[parts.length - 1] ?? sourcePath;
  const fileLabel = TOP_LEVEL_DOCUMENT_LABELS.get(fileName) ?? formatGraphSegmentLabel(fileName.replace(/\.md$/u, ""));

  if (parts.length === 1) {
    return fileLabel;
  }

  const folderPath = parts.slice(0, -1).join("/");
  return `${formatGraphFolderLabel(folderPath)} / ${fileLabel}`;
}

function formatGraphSegmentLabel(value: string) {
  return value
    .replace(/\.md$/u, "")
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
