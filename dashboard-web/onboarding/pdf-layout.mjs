const MIN_COLUMN_GAP = 18;
const MAX_COLUMNS = 3;

export function reconstructPdfPage(items, viewport = {}) {
  const pageWidth = Number(viewport.width) || inferPageWidth(items);
  const normalized = items.map(normalizeItem).filter((item) => item.text);
  if (normalized.length === 0) return { text: '', columns: 1, lineCount: 0 };

  const lines = groupItemsIntoLines(normalized);
  const cuts = detectColumnCuts(lines, pageWidth);
  const ordered = cuts.length ? orderColumnLines(lines, cuts) : [...lines].sort(byReadingPosition);
  return {
    text: renderLines(ordered),
    columns: cuts.length + 1,
    lineCount: lines.length,
  };
}

function normalizeItem(item) {
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  const height = Math.max(Math.abs(Number(item?.height) || 0), Math.abs(Number(transform[3]) || 0), 8);
  return {
    text: String(item?.str || '').replace(/\s+/g, ' ').trim(),
    x: Number(transform[4]) || 0,
    y: Number(transform[5]) || 0,
    width: Math.max(Number(item?.width) || 0, String(item?.str || '').length * height * 0.35),
    height,
  };
}

function groupItemsIntoLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const tolerance = Math.max(1.5, median(sorted.map((item) => item.height)) * 0.28);
  const lines = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = line.items.reduce((sum, current) => sum + current.y, 0) / line.items.length;
  }
  return lines.flatMap((line) => {
    const clusters = [];
    for (const item of line.items.sort((a, b) => a.x - b.x)) {
      const cluster = clusters.at(-1);
      const previous = cluster?.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      if (!cluster || gap > Math.max(24, Math.min(previous.height, item.height) * 2.2)) {
        clusters.push([item]);
      } else {
        cluster.push(item);
      }
    }
    return clusters.map((lineItems) => ({
      text: joinLineItems(lineItems),
      y: line.y,
      xMin: Math.min(...lineItems.map((item) => item.x)),
      xMax: Math.max(...lineItems.map((item) => item.x + item.width)),
      height: Math.max(...lineItems.map((item) => item.height)),
    }));
  }).filter((line) => line.text);
}

function joinLineItems(items) {
  let output = '';
  let previous = null;
  for (const item of items) {
    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      if (
        gap > Math.max(0.8, Math.min(previous.height, item.height) * 0.12)
        && !/^[,.;:!?%)\]}]/.test(item.text)
        && !/[([{/$-]$/.test(output)
      ) output += ' ';
    }
    output += item.text;
    previous = item;
  }
  return output.replace(/\s+/g, ' ').trim();
}

function detectColumnCuts(lines, pageWidth) {
  if (lines.length < 8 || pageWidth < 200) return [];
  const binSize = Math.max(3, pageWidth / 180);
  const bins = Math.ceil(pageWidth / binSize);
  const occupied = new Array(bins).fill(0);
  const eligible = lines.filter((line) => line.xMax - line.xMin < pageWidth * 0.72);
  for (const line of eligible) {
    const start = Math.max(0, Math.floor(line.xMin / binSize));
    const end = Math.min(bins - 1, Math.ceil(line.xMax / binSize));
    for (let index = start; index <= end; index += 1) occupied[index] += 1;
  }

  const gaps = [];
  let start = null;
  for (let index = 0; index <= occupied.length; index += 1) {
    if (occupied[index] === 0 && index < occupied.length) {
      if (start === null) start = index;
      continue;
    }
    if (start === null) continue;
    const end = index - 1;
    const gapStart = start * binSize;
    const gapEnd = (end + 1) * binSize;
    const cut = (gapStart + gapEnd) / 2;
    const left = eligible.filter((line) => line.xMax < cut).length;
    const right = eligible.filter((line) => line.xMin > cut).length;
    if (
      gapEnd - gapStart >= MIN_COLUMN_GAP
      && cut > pageWidth * 0.12
      && cut < pageWidth * 0.88
      && left >= 3
      && right >= 3
    ) gaps.push({ cut, width: gapEnd - gapStart, support: Math.min(left, right) });
    start = null;
  }

  const selected = [];
  for (const gap of gaps.sort((a, b) => b.support - a.support || b.width - a.width)) {
    if (selected.every((value) => Math.abs(value - gap.cut) > pageWidth * 0.16)) selected.push(gap.cut);
    if (selected.length === MAX_COLUMNS - 1) break;
  }
  return selected.sort((a, b) => a - b);
}

function orderColumnLines(lines, cuts) {
  const spanning = [];
  const columns = Array.from({ length: cuts.length + 1 }, () => []);
  for (const line of lines) {
    if (cuts.some((cut) => line.xMin < cut && line.xMax > cut)) {
      spanning.push(line);
      continue;
    }
    const center = (line.xMin + line.xMax) / 2;
    columns[cuts.filter((cut) => center > cut).length].push(line);
  }
  spanning.sort(byReadingPosition);
  columns.forEach((column) => column.sort(byReadingPosition));

  const output = [];
  let upperY = Number.POSITIVE_INFINITY;
  for (const separator of spanning) {
    appendRegion(output, columns, upperY, separator.y);
    output.push(separator);
    upperY = separator.y;
  }
  appendRegion(output, columns, upperY, Number.NEGATIVE_INFINITY);
  return output;
}

function appendRegion(output, columns, upperY, lowerY) {
  for (const column of columns) {
    for (const line of column) {
      if (line.used || line.y >= upperY || line.y <= lowerY) continue;
      output.push(line);
      line.used = true;
    }
  }
}

function renderLines(lines) {
  const output = [];
  let previous = null;
  for (const line of lines) {
    if (previous && Math.abs(previous.y - line.y) > Math.max(previous.height, line.height) * 1.75) output.push('');
    output.push(line.text);
    previous = line;
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function inferPageWidth(items) {
  return Math.max(612, ...items.map((item) => {
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    return (Number(transform[4]) || 0) + (Number(item?.width) || 0);
  }));
}

function byReadingPosition(a, b) {
  return b.y - a.y || a.xMin - b.xMin;
}

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 10;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
