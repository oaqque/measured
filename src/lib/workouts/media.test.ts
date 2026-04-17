import { describe, expect, it } from "vitest";
import { resolveWorkoutMediaEmbed, resolveWorkoutMediaThumbnail } from "@/lib/workouts/media";

describe("resolveWorkoutMediaEmbed", () => {
  it("resolves spotify links to embed URLs", () => {
    expect(
      resolveWorkoutMediaEmbed({
        provider: "spotify",
        url: "https://open.spotify.com/track/2TpxZ7JUBn3uw46aR7qd6V?si=abc123",
        title: "Recovery track",
      }),
    ).toEqual({
      embedUrl: "https://open.spotify.com/embed/track/2TpxZ7JUBn3uw46aR7qd6V?utm_source=generator",
      iframeTitle: "Recovery track",
      provider: "spotify",
      shape: "audio",
    });
  });

  it("resolves youtube watch links to embed URLs", () => {
    expect(
      resolveWorkoutMediaEmbed({
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).toEqual({
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      iframeTitle: "YouTube player",
      provider: "youtube",
      shape: "video",
    });
  });

  it("returns null for unsupported links", () => {
    expect(
      resolveWorkoutMediaEmbed({
        provider: "youtube",
        url: "https://example.com/video",
      }),
    ).toBeNull();
  });

  it("derives youtube thumbnails without a network request", async () => {
    await expect(
      resolveWorkoutMediaThumbnail({
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).resolves.toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("reads spotify thumbnails from oEmbed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          thumbnail_url: "https://i.scdn.co/image/example-cover",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

    await expect(
      resolveWorkoutMediaThumbnail(
        {
          provider: "spotify",
          url: "https://open.spotify.com/episode/1viBRy6dQdlSw0OdFvogXB",
        },
        fetchImpl,
      ),
    ).resolves.toBe("https://i.scdn.co/image/example-cover");
  });
});
