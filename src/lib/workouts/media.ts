import type { WorkoutMediaEmbed } from "./schema";

type ResolvedWorkoutMediaEmbed = {
  embedUrl: string;
  iframeTitle: string;
  provider: WorkoutMediaEmbed["provider"];
  shape: "audio" | "video";
};

const SPOTIFY_ENTITY_TYPES = new Set(["track", "album", "playlist", "episode", "show"]);

type WorkoutMediaFetch = typeof fetch;

export function resolveWorkoutMediaEmbed(media: WorkoutMediaEmbed | null | undefined): ResolvedWorkoutMediaEmbed | null {
  if (!media) {
    return null;
  }

  if (media.provider === "spotify") {
    return resolveSpotifyEmbed(media);
  }

  if (media.provider === "youtube") {
    return resolveYouTubeEmbed(media);
  }

  return null;
}

export async function resolveWorkoutMediaThumbnail(
  media: WorkoutMediaEmbed | null | undefined,
  fetchImpl: WorkoutMediaFetch = fetch,
): Promise<string | null> {
  if (!media) {
    return null;
  }

  if (media.provider === "youtube") {
    const videoId = parseYouTubeVideoId(media.url);
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  }

  if (media.provider === "spotify") {
    const oEmbedUrl = buildSpotifyOEmbedUrl(media.url);
    if (!oEmbedUrl) {
      return null;
    }

    try {
      const response = await fetchImpl(oEmbedUrl);
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { thumbnail_url?: unknown };
      return typeof payload.thumbnail_url === "string" && payload.thumbnail_url.trim().length > 0
        ? payload.thumbnail_url
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function resolveSpotifyEmbed(media: WorkoutMediaEmbed): ResolvedWorkoutMediaEmbed | null {
  const entity = parseSpotifyEntity(media.url);
  if (!entity) {
    return null;
  }

  return {
    embedUrl: `https://open.spotify.com/embed/${entity.type}/${entity.id}?utm_source=generator`,
    iframeTitle: media.title?.trim() || "Spotify player",
    provider: "spotify",
    shape: "audio",
  };
}

function resolveYouTubeEmbed(media: WorkoutMediaEmbed): ResolvedWorkoutMediaEmbed | null {
  const videoId = parseYouTubeVideoId(media.url);
  if (!videoId) {
    return null;
  }

  return {
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    iframeTitle: media.title?.trim() || "YouTube player",
    provider: "youtube",
    shape: "video",
  };
}

function parseSpotifyEntity(rawUrl: string) {
  const normalized = rawUrl.trim();
  if (!normalized) {
    return null;
  }

  const spotifyUriMatch = normalized.match(/^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)$/u);
  if (spotifyUriMatch) {
    return {
      id: spotifyUriMatch[2],
      type: spotifyUriMatch[1],
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (!parsed.hostname.endsWith("spotify.com")) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const typeIndex = segments.findIndex((segment) => SPOTIFY_ENTITY_TYPES.has(segment));
  if (typeIndex === -1) {
    return null;
  }

  const type = segments[typeIndex];
  const id = segments[typeIndex + 1];
  if (!type || !id) {
    return null;
  }

  return { id, type };
}

function parseYouTubeVideoId(rawUrl: string) {
  const normalized = rawUrl.trim();
  if (!normalized) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./u, "");
  if (hostname === "youtu.be") {
    return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  }

  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v");
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "embed" || segments[0] === "shorts") {
      return segments[1] ?? null;
    }
  }

  return null;
}

function buildSpotifyOEmbedUrl(rawUrl: string) {
  const normalized = rawUrl.trim();
  if (!normalized) {
    return null;
  }

  return `https://open.spotify.com/oembed?url=${encodeURIComponent(normalized)}`;
}
