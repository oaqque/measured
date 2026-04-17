import matter from "gray-matter";
import {
  WORKOUT_MEDIA_PROVIDERS,
  WORKOUT_NOTE_SOURCE_SCHEMA_VERSION,
  type AppleHealthAnalysisMeasurement,
  type StravaAnalysisMeasurement,
  type WorkoutNoteAnalysisSection,
  type WorkoutMediaEmbed,
  type WorkoutNoteMarkdownSection,
  type WorkoutNoteSourceDocument,
  type WorkoutNoteSourceSection,
} from "./schema";

const topLevelSectionHeadingMap = {
  program: "Program",
  importedFromStrava: "Imported from Strava",
  analysis: "Analysis",
} as const;

const analysisSectionHeadingMap = {
  intention: "Intention",
  shortTermGoal: "Short-Term Goal",
  longTermGoal: "Long-Term Goal",
  personalNote: "Personal Note",
} as const;

const appleHealthMeasurementHeadingMap: Record<AppleHealthAnalysisMeasurement, string> = {
  heartRate: "Apple Health Heart Rate",
  cadence: "Apple Health Cadence",
};

const stravaMeasurementHeadingMap: Record<StravaAnalysisMeasurement, string> = {
  pace: "Strava Pace",
  heartRate: "Strava Heart Rate",
  moving: "Strava Moving",
  elevation: "Strava Elevation",
};

export function parseWorkoutNoteSourceDocument(fileName: string, fileContent: string): WorkoutNoteSourceDocument {
  if (fileName.endsWith(".json")) {
    return normalizeWorkoutNoteSourceDocument(JSON.parse(fileContent) as unknown, fileName);
  }

  if (fileName.endsWith(".md")) {
    return convertLegacyMarkdownWorkoutNote(fileName, fileContent);
  }

  throw new Error(`${fileName}: unsupported workout note file type`);
}

export function serializeWorkoutNoteSourceDocument(document: WorkoutNoteSourceDocument) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function renderWorkoutNoteSourceDocumentBody(document: WorkoutNoteSourceDocument) {
  return renderWorkoutNoteSections(document.sections);
}

export function hasImportedFromStravaSection(document: WorkoutNoteSourceDocument) {
  return document.sections.some((section) => section.kind === "importedFromStrava");
}

export function getWorkoutNoteBaseName(fileName: string) {
  return fileName.replace(/\.(md|json)$/u, "");
}

export function convertLegacyMarkdownWorkoutNote(fileName: string, fileContent: string): WorkoutNoteSourceDocument {
  const parsed = matter(fileContent);
  const data = parsed.data as Record<string, unknown>;
  const topLevelSections = parseMarkdownSections(parsed.content, 2);
  const sections: WorkoutNoteSourceSection[] = [];

  if (topLevelSections.leadingMarkdown) {
    sections.push({
      kind: "markdown",
      heading: "Notes",
      markdown: topLevelSections.leadingMarkdown,
    });
  }

  for (const section of topLevelSections.sections) {
    if (section.heading === "Program") {
      sections.push({
        kind: "program",
        markdown: section.markdown,
      });
      continue;
    }

    if (section.heading === "Imported from Strava") {
      sections.push({
        kind: "importedFromStrava",
        markdown: section.markdown,
      });
      continue;
    }

    if (section.heading === "Analysis") {
      const analysisSections = parseMarkdownSections(section.markdown, 3);
      const structuredSections: WorkoutNoteAnalysisSection[] = analysisSections.sections.map((analysisSection) =>
        convertAnalysisSection(analysisSection.heading, analysisSection.markdown),
      );
      sections.push({
        kind: "analysis",
        summaryMarkdown: analysisSections.leadingMarkdown || undefined,
        sections: structuredSections,
      });
      continue;
    }

    sections.push({
      kind: "markdown",
      heading: section.heading,
      markdown: section.markdown,
    });
  }

  return normalizeWorkoutNoteSourceDocument(
    {
      schemaVersion: WORKOUT_NOTE_SOURCE_SCHEMA_VERSION,
      title: data.title,
      allDay: data.allDay,
      type: data.type,
      date: data.date,
      completed: data.completed,
      eventType: data.eventType,
      expectedDistance: data.expectedDistance,
      actualDistance: data.actualDistance,
      stravaId: data.stravaId,
      activityRefs: data.activityRefs,
      media: data.media,
      sections,
    },
    fileName,
  );
}

function convertAnalysisSection(heading: string, markdown: string): WorkoutNoteAnalysisSection {
  const normalizedHeading = normalizeHeadingKey(heading);
  if (normalizedHeading === "intention") {
    return { kind: "intention", markdown };
  }

  if (normalizedHeading === "short term goal") {
    return { kind: "shortTermGoal", markdown };
  }

  if (normalizedHeading === "long term goal") {
    return { kind: "longTermGoal", markdown };
  }

  if (normalizedHeading === "personal note") {
    return { kind: "personalNote", markdown };
  }

  if (normalizedHeading === "apple health heart rate") {
    return { kind: "appleHealthMeasurement", measurement: "heartRate", markdown };
  }

  if (normalizedHeading === "apple health cadence") {
    return { kind: "appleHealthMeasurement", measurement: "cadence", markdown };
  }

  if (normalizedHeading === "strava pace") {
    return { kind: "stravaMeasurement", measurement: "pace", markdown };
  }

  if (normalizedHeading === "strava heart rate") {
    return { kind: "stravaMeasurement", measurement: "heartRate", markdown };
  }

  if (normalizedHeading === "strava moving") {
    return { kind: "stravaMeasurement", measurement: "moving", markdown };
  }

  if (normalizedHeading === "strava elevation") {
    return { kind: "stravaMeasurement", measurement: "elevation", markdown };
  }

  return {
    kind: "markdown",
    heading,
    markdown,
  };
}

function renderWorkoutNoteSections(sections: WorkoutNoteSourceSection[]) {
  return sections
    .map((section) => {
      if (section.kind === "program") {
        return renderMarkdownSection(topLevelSectionHeadingMap.program, section.markdown, 2);
      }

      if (section.kind === "importedFromStrava") {
        return renderMarkdownSection(topLevelSectionHeadingMap.importedFromStrava, section.markdown, 2);
      }

      if (section.kind === "analysis") {
        const parts: string[] = [];
        if (section.summaryMarkdown) {
          parts.push(section.summaryMarkdown.trim());
        }

        for (const analysisSection of section.sections) {
          parts.push(renderAnalysisSection(analysisSection));
        }

        return renderMarkdownSection(topLevelSectionHeadingMap.analysis, parts.filter(Boolean).join("\n\n"), 2);
      }

      return renderMarkdownSection(section.heading, section.markdown, 2);
    })
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function renderAnalysisSection(section: WorkoutNoteAnalysisSection) {
  if (section.kind === "intention") {
    return renderMarkdownSection(analysisSectionHeadingMap.intention, section.markdown, 3);
  }

  if (section.kind === "shortTermGoal") {
    return renderMarkdownSection(analysisSectionHeadingMap.shortTermGoal, section.markdown, 3);
  }

  if (section.kind === "longTermGoal") {
    return renderMarkdownSection(analysisSectionHeadingMap.longTermGoal, section.markdown, 3);
  }

  if (section.kind === "personalNote") {
    return renderMarkdownSection(analysisSectionHeadingMap.personalNote, section.markdown, 3);
  }

  if (section.kind === "appleHealthMeasurement") {
    return renderMarkdownSection(appleHealthMeasurementHeadingMap[section.measurement], section.markdown, 3);
  }

  if (section.kind === "stravaMeasurement") {
    return renderMarkdownSection(stravaMeasurementHeadingMap[section.measurement], section.markdown, 3);
  }

  if (section.kind === "markdown") {
    return renderMarkdownSection(section.heading, section.markdown, 3);
  }

  return "";
}

function renderMarkdownSection(heading: string, markdown: string, level: 2 | 3) {
  const normalizedMarkdown = markdown.trim();
  if (normalizedMarkdown.length === 0) {
    return `${"#".repeat(level)} ${heading}`;
  }

  return `${"#".repeat(level)} ${heading}\n\n${normalizedMarkdown}`;
}

function parseMarkdownSections(markdown: string, level: 2 | 3) {
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const headingPattern = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`, "u");
  const sections: Array<{ heading: string; markdown: string }> = [];
  let leadingLines: string[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let insideCodeFence = false;

  const flushSection = () => {
    const normalizedMarkdown = normalizeMarkdownBlock(currentLines.join("\n"));
    if (currentHeading !== null) {
      sections.push({
        heading: currentHeading,
        markdown: normalizedMarkdown,
      });
    }
  };

  for (const line of lines) {
    if (/^```/u.test(line.trim())) {
      insideCodeFence = !insideCodeFence;
    }

    const match = !insideCodeFence ? line.match(headingPattern) : null;
    if (match) {
      if (currentHeading === null) {
        leadingLines = currentLines;
      } else {
        flushSection();
      }

      currentHeading = match[1]!.trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentHeading === null) {
    leadingLines = currentLines;
  } else {
    flushSection();
  }

  return {
    leadingMarkdown: normalizeMarkdownBlock(leadingLines.join("\n")),
    sections,
  };
}

function normalizeWorkoutNoteSourceDocument(value: unknown, fileName: string): WorkoutNoteSourceDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: workout note document must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion !== WORKOUT_NOTE_SOURCE_SCHEMA_VERSION) {
    throw new Error(
      `${fileName}: schemaVersion must be ${WORKOUT_NOTE_SOURCE_SCHEMA_VERSION}`,
    );
  }

  const sections = candidate.sections;
  if (!Array.isArray(sections)) {
    throw new Error(`${fileName}: sections must be an array`);
  }

  if (candidate.media !== undefined && !isPlainObject(candidate.media)) {
    throw new Error(`${fileName}: media must be an object`);
  }

  return {
    schemaVersion: WORKOUT_NOTE_SOURCE_SCHEMA_VERSION,
    title: candidate.title as string,
    allDay: candidate.allDay as boolean,
    type: candidate.type as string,
    date: candidate.date as string,
    completed: candidate.completed as false | string,
    eventType: candidate.eventType as WorkoutNoteSourceDocument["eventType"],
    ...(typeof candidate.expectedDistance === "string" ? { expectedDistance: candidate.expectedDistance } : {}),
    ...(typeof candidate.actualDistance === "string" ? { actualDistance: candidate.actualDistance } : {}),
    ...(typeof candidate.stravaId === "number" ? { stravaId: candidate.stravaId } : {}),
    ...(isPlainObject(candidate.activityRefs) ? { activityRefs: candidate.activityRefs as WorkoutNoteSourceDocument["activityRefs"] } : {}),
    ...(isPlainObject(candidate.media) ? { media: normalizeWorkoutMediaEmbed(candidate.media, fileName) } : {}),
    sections: sections.map((section, index) => normalizeWorkoutNoteSourceSection(section, fileName, index)),
  };
}

function normalizeWorkoutMediaEmbed(value: unknown, fileName: string): WorkoutMediaEmbed {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: media must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.provider !== "string" ||
    !WORKOUT_MEDIA_PROVIDERS.includes(candidate.provider as (typeof WORKOUT_MEDIA_PROVIDERS)[number])
  ) {
    throw new Error(`${fileName}: media.provider must be one of ${WORKOUT_MEDIA_PROVIDERS.join(", ")}`);
  }

  if (typeof candidate.url !== "string" || candidate.url.trim().length === 0) {
    throw new Error(`${fileName}: media.url must be a non-empty string`);
  }

  return {
    provider: candidate.provider as WorkoutMediaEmbed["provider"],
    url: candidate.url.trim(),
    ...(typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? { title: candidate.title.trim() }
      : {}),
  };
}

function normalizeWorkoutNoteSourceSection(
  value: unknown,
  fileName: string,
  sectionIndex: number,
): WorkoutNoteSourceSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: sections[${sectionIndex}] must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind === "program" || kind === "importedFromStrava") {
    return {
      kind,
      markdown: normalizeMarkdownField(candidate.markdown),
    };
  }

  if (kind === "analysis") {
    const sections = candidate.sections;
    if (!Array.isArray(sections)) {
      throw new Error(`${fileName}: analysis section ${sectionIndex} must contain a sections array`);
    }

    return {
      kind: "analysis",
      ...(typeof candidate.summaryMarkdown === "string" ? { summaryMarkdown: candidate.summaryMarkdown } : {}),
      sections: sections.map((section, index) => normalizeWorkoutNoteAnalysisSection(section, fileName, sectionIndex, index)),
    };
  }

  if (kind === "markdown") {
    return {
      kind: "markdown",
      heading: normalizeHeadingField(candidate.heading, fileName, sectionIndex),
      markdown: normalizeMarkdownField(candidate.markdown),
    };
  }

  throw new Error(`${fileName}: unsupported section kind at sections[${sectionIndex}]`);
}

function normalizeWorkoutNoteAnalysisSection(
  value: unknown,
  fileName: string,
  sectionIndex: number,
  analysisIndex: number,
): WorkoutNoteAnalysisSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: analysis sections[${analysisIndex}] must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind === "intention" || kind === "shortTermGoal" || kind === "longTermGoal" || kind === "personalNote") {
    return {
      kind,
      markdown: normalizeMarkdownField(candidate.markdown),
    };
  }

  if (kind === "appleHealthMeasurement") {
    if (candidate.measurement !== "heartRate" && candidate.measurement !== "cadence") {
      throw new Error(
        `${fileName}: invalid appleHealth measurement in analysis section ${sectionIndex}.${analysisIndex}`,
      );
    }

    return {
      kind,
      measurement: candidate.measurement,
      markdown: normalizeMarkdownField(candidate.markdown),
    };
  }

  if (kind === "stravaMeasurement") {
    if (
      candidate.measurement !== "pace" &&
      candidate.measurement !== "heartRate" &&
      candidate.measurement !== "moving" &&
      candidate.measurement !== "elevation"
    ) {
      throw new Error(
        `${fileName}: invalid strava measurement in analysis section ${sectionIndex}.${analysisIndex}`,
      );
    }

    return {
      kind,
      measurement: candidate.measurement,
      markdown: normalizeMarkdownField(candidate.markdown),
    };
  }

  if (kind === "markdown") {
    return {
      kind: "markdown",
      heading: normalizeHeadingField(candidate.heading, fileName, analysisIndex),
      markdown: normalizeMarkdownField(candidate.markdown),
    } satisfies WorkoutNoteMarkdownSection;
  }

  throw new Error(`${fileName}: unsupported analysis section kind at sections[${sectionIndex}].sections[${analysisIndex}]`);
}

function normalizeMarkdownBlock(value: string) {
  return value.trim();
}

function normalizeMarkdownField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHeadingField(value: unknown, fileName: string, index: number) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fileName}: section heading at index ${index} must be a non-empty string`);
  }

  return value.trim();
}

function normalizeHeadingKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
