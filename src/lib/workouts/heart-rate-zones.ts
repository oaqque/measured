export type HeartRateZoneBand = {
  color: string;
  label: string;
  minimum: number;
};

export const LTHR_HEART_RATE_ZONE_BANDS: HeartRateZoneBand[] = [
  { color: "#1d4ed8", label: "Z1 < 147 bpm", minimum: Number.NEGATIVE_INFINITY },
  { color: "#0284c7", label: "Z2 147-155 bpm", minimum: 147 },
  { color: "#ca8a04", label: "Z3 156-163 bpm", minimum: 156 },
  { color: "#ea580c", label: "Z4 164-172 bpm", minimum: 164 },
  { color: "#b91c1c", label: "Z5 173-177 bpm", minimum: 173 },
  { color: "#7f1d1d", label: "Z6 178+ bpm", minimum: 178 },
];

export function getLthrHeartRateZoneColor(heartRate: number) {
  for (let index = LTHR_HEART_RATE_ZONE_BANDS.length - 1; index >= 0; index -= 1) {
    if (heartRate >= LTHR_HEART_RATE_ZONE_BANDS[index].minimum) {
      return LTHR_HEART_RATE_ZONE_BANDS[index].color;
    }
  }

  return LTHR_HEART_RATE_ZONE_BANDS[0].color;
}
