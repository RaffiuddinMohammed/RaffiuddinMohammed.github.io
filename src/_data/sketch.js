// Hand-drawn charts rendered at build time with BorrowdaleJS (borrowdalejs.com).
// The SVG is inlined into the page, so visitors download no chart library.
// If the library ever throws (it is pre-1.0), the value is null and the page keeps its regular chart.
import { readFileSync } from 'node:fs';
import { layoutChart, toSvgChart } from '@borrowdale/charts';
import { excalifontFiles } from '@borrowdale/text/excalifont-files';

export default function () {
  try {
    const bbc = JSON.parse(readFileSync(new URL('./bbc.json', import.meta.url)));
    if (!bbc.sections?.length) return { sections: null };
    const chart = layoutChart({
      width: 440,
      height: 300,
      fontSize: 14,
      seed: 'busiest-sections', // same strokes every build, so the drawing doesn't jitter day to day
      axes: {
        y: { type: 'band', categories: bbc.sections.map((s) => s.name) },
        x: { type: 'linear', title: 'Stories, last 24 hours' },
      },
      series: [{ type: 'bar', name: 'Stories', color: '#2a78d6', data: bbc.sections.map((s) => s.count), dataLabels: true }],
    });
    return { sections: toSvgChart(chart, { fontFiles: excalifontFiles }) };
  } catch (e) {
    console.warn(`[sketch] BorrowdaleJS chart skipped: ${e.message}`);
    return { sections: null };
  }
}
