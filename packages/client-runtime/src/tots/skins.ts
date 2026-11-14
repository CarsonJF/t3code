/** A BoopFace skin series; its skins are numbered `series * 100 + 1` onward. */
export interface TotSkinSeries {
  readonly series: number;
  readonly title: string;
  readonly count: number;
}

// BoopFace 0.8's skin numbers are permanent; titles match its gallery.
export const TOT_SKIN_SERIES: ReadonlyArray<TotSkinSeries> = [
  { series: 1, title: "Glaze", count: 6 },
  { series: 2, title: "Ice glass", count: 6 },
  { series: 3, title: "Gummy", count: 12 },
  { series: 4, title: "Candy glass", count: 6 },
  { series: 5, title: "Acrylic", count: 12 },
  { series: 6, title: "Jelly", count: 12 },
  { series: 7, title: "Gradient", count: 12 },
  { series: 8, title: "Frosted glass", count: 6 },
  { series: 9, title: "Metal", count: 30 },
  { series: 10, title: "Gems and ceramics", count: 12 },
  { series: 11, title: "Wood", count: 6 },
  { series: 12, title: "Balls", count: 10 },
  { series: 13, title: "Clear and shimmer", count: 5 },
  { series: 14, title: "Fabric and leather", count: 12 },
  { series: 15, title: "Sweets and fruit", count: 12 },
  { series: 16, title: "Nature", count: 12 },
  { series: 17, title: "Patterns and tech", count: 17 },
];

export const totSkinsIn = (series: TotSkinSeries): ReadonlyArray<number> =>
  Array.from({ length: series.count }, (_, i) => series.series * 100 + i + 1);

/** The series a skin belongs to, or the first series for no skin. */
export const totSkinSeriesOf = (skin: number | null): TotSkinSeries =>
  TOT_SKIN_SERIES.find((series) => skin !== null && Math.floor(skin / 100) === series.series) ??
  TOT_SKIN_SERIES[0]!;
