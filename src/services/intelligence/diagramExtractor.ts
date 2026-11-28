import type {
  DiagramEdgeItem,
  DiagramNodeItem,
  DiagramSemanticType,
  ExtractedDiagramAsset,
  VectorDiagramScene,
} from '../../core/types';
import { encodeGrayToPngDataUrl } from './imagePreprocessor';

export interface PdfTextTokenLike {
  str: string;
  x: number;
  y: number; // PDF bottom-up Y
  w: number;
  h: number;
}

type Matrix6 = [number, number, number, number, number, number];

function multiplyMatrix(m1: Matrix6, m2: Matrix6): Matrix6 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function transformPoint(m: Matrix6, x: number, y: number, pageHeight: number): [number, number] {
  const px = m[0] * x + m[2] * y + m[4];
  const py = m[1] * x + m[3] * y + m[5];
  return [px, pageHeight - py];
}

interface RawVectorPath {
  points: Array<[number, number]>;
  closed: boolean;
  dashed: boolean;
  fill: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  isAxisAligned: boolean;
  hasCurve: boolean;
}

function sampleCubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  steps = 8
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const u = 1 - t;
    const x =
      u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

function finalizePath(
  points: Array<[number, number]>,
  closed: boolean,
  dashed: boolean,
  fill: boolean,
  hasCurve: boolean
): RawVectorPath | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  let isAxisAligned = !hasCurve;
  if (isAxisAligned) {
    for (let i = 1; i < points.length; i += 1) {
      const dx = Math.abs(points[i][0] - points[i - 1][0]);
      const dy = Math.abs(points[i][1] - points[i - 1][1]);
      if (dx > 1.2 && dy > 1.2) {
        isAxisAligned = false;
        break;
      }
    }
  }

  return {
    points,
    closed,
    dashed,
    fill,
    minX,
    minY,
    maxX,
    maxY,
    isAxisAligned,
    hasCurve,
  };
}

/**
 * Extracts vector drawings (lines, polygons, triangles, rectangles, curves, circuits, axes)
 * from a PDF page's operator list into clean, clustered VectorDiagramScene objects with
 * nearby vertex/axis labels attached.
 */
export function extractPdfVectorDiagrams(params: {
  opList: { fnArray: number[]; argsArray: unknown[][] };
  OPS: Record<string, number>;
  pageWidth: number;
  pageHeight: number;
  textTokens?: PdfTextTokenLike[];
  pageNumber: number;
}): ExtractedDiagramAsset[] {
  const { opList, OPS, pageWidth, pageHeight, textTokens = [], pageNumber } = params;
  if (!opList || !Array.isArray(opList.fnArray) || opList.fnArray.length === 0) return [];

  let ctm: Matrix6 = [1, 0, 0, 1, 0, 0];
  let isDashed = false;
  const stack: Array<{ ctm: Matrix6; isDashed: boolean }> = [];

  let activeSubpaths: Array<{
    points: Array<[number, number]>;
    closed: boolean;
    hasCurve: boolean;
  }> = [];
  let currentSubpath: { points: Array<[number, number]>; closed: boolean; hasCurve: boolean } | null =
    null;

  const collectedPaths: RawVectorPath[] = [];

  const pushPathOp = (op: number, args: number[], offset: number): number => {
    if (op === OPS.moveTo) {
      const x = args[offset];
      const y = args[offset + 1];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const pt = transformPoint(ctm, x, y, pageHeight);
        currentSubpath = { points: [pt], closed: false, hasCurve: false };
        activeSubpaths.push(currentSubpath);
      }
      return offset + 2;
    }
    if (op === OPS.lineTo) {
      const x = args[offset];
      const y = args[offset + 1];
      if (currentSubpath && Number.isFinite(x) && Number.isFinite(y)) {
        currentSubpath.points.push(transformPoint(ctm, x, y, pageHeight));
      }
      return offset + 2;
    }
    if (op === OPS.curveTo) {
      if (currentSubpath && currentSubpath.points.length > 0) {
        const p0 = currentSubpath.points[currentSubpath.points.length - 1];
        const p1 = transformPoint(ctm, args[offset], args[offset + 1], pageHeight);
        const p2 = transformPoint(ctm, args[offset + 2], args[offset + 3], pageHeight);
        const p3 = transformPoint(ctm, args[offset + 4], args[offset + 5], pageHeight);
        currentSubpath.hasCurve = true;
        currentSubpath.points.push(...sampleCubicBezier(p0, p1, p2, p3));
      }
      return offset + 6;
    }
    if (op === OPS.curveTo2) {
      if (currentSubpath && currentSubpath.points.length > 0) {
        const p0 = currentSubpath.points[currentSubpath.points.length - 1];
        const p2 = transformPoint(ctm, args[offset], args[offset + 1], pageHeight);
        const p3 = transformPoint(ctm, args[offset + 2], args[offset + 3], pageHeight);
        currentSubpath.hasCurve = true;
        currentSubpath.points.push(...sampleCubicBezier(p0, p0, p2, p3));
      }
      return offset + 4;
    }
    if (op === OPS.curveTo3) {
      if (currentSubpath && currentSubpath.points.length > 0) {
        const p0 = currentSubpath.points[currentSubpath.points.length - 1];
        const p1 = transformPoint(ctm, args[offset], args[offset + 1], pageHeight);
        const p3 = transformPoint(ctm, args[offset + 2], args[offset + 3], pageHeight);
        currentSubpath.hasCurve = true;
        currentSubpath.points.push(...sampleCubicBezier(p0, p1, p3, p3));
      }
      return offset + 4;
    }
    if (op === OPS.rectangle) {
      const rx = args[offset];
      const ry = args[offset + 1];
      const rw = args[offset + 2];
      const rh = args[offset + 3];
      if (
        Number.isFinite(rx) &&
        Number.isFinite(ry) &&
        Number.isFinite(rw) &&
        Number.isFinite(rh)
      ) {
        const p0 = transformPoint(ctm, rx, ry, pageHeight);
        const p1 = transformPoint(ctm, rx + rw, ry, pageHeight);
        const p2 = transformPoint(ctm, rx + rw, ry + rh, pageHeight);
        const p3 = transformPoint(ctm, rx, ry + rh, pageHeight);
        currentSubpath = {
          points: [p0, p1, p2, p3, p0],
          closed: true,
          hasCurve: false,
        };
        activeSubpaths.push(currentSubpath);
      }
      return offset + 4;
    }
    if (op === OPS.closePath) {
      if (currentSubpath && currentSubpath.points.length >= 2) {
        currentSubpath.closed = true;
        const first = currentSubpath.points[0];
        const last = currentSubpath.points[currentSubpath.points.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.8) {
          currentSubpath.points.push([first[0], first[1]]);
        }
      }
      return offset;
    }
    return offset;
  };

  const flushSubpaths = (paintedFill: boolean, paintedStroke: boolean) => {
    if (!paintedFill && !paintedStroke) {
      activeSubpaths = [];
      currentSubpath = null;
      return;
    }
    for (const sp of activeSubpaths) {
      const built = finalizePath(
        sp.points,
        sp.closed,
        isDashed,
        paintedFill && !paintedStroke,
        sp.hasCurve
      );
      if (!built) continue;
      const w = built.maxX - built.minX;
      const h = built.maxY - built.minY;
      // Ignore full-page frames/white background fills and tiny sub-3pt specks
      const isPageBackground = w > pageWidth * 0.82 && h > pageHeight * 0.82;
      const isTinyDot = w < 3 && h < 3;
      if (!isPageBackground && !isTinyDot) {
        collectedPaths.push(built);
      }
    }
    activeSubpaths = [];
    currentSubpath = null;
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] ?? [];

    if (fn === OPS.save) {
      stack.push({ ctm: [...ctm] as Matrix6, isDashed });
    } else if (fn === OPS.restore) {
      const prev = stack.pop();
      if (prev) {
        ctm = prev.ctm;
        isDashed = prev.isDashed;
      }
    } else if (fn === OPS.transform && args.length >= 6) {
      const m: Matrix6 = [
        Number(args[0]) || 0,
        Number(args[1]) || 0,
        Number(args[2]) || 0,
        Number(args[3]) || 0,
        Number(args[4]) || 0,
        Number(args[5]) || 0,
      ];
      ctm = multiplyMatrix(ctm, m);
    } else if (fn === OPS.setDash) {
      const dashArr = args[0];
      isDashed = Array.isArray(dashArr) && dashArr.length > 0;
    } else if (fn === OPS.constructPath) {
      const subOpsRaw = args[0];
      const coordsContainer = args[1];

      const applyPaintOp = (paintOp: number) => {
        if (paintOp === OPS.stroke || paintOp === OPS.closeStroke) {
          if (paintOp === OPS.closeStroke && currentSubpath) {
            pushPathOp(OPS.closePath, [], 0);
          }
          flushSubpaths(false, true);
        } else if (paintOp === OPS.fill || paintOp === OPS.eoFill) {
          flushSubpaths(true, false);
        } else if (
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke
        ) {
          if (paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke) {
            pushPathOp(OPS.closePath, [], 0);
          }
          flushSubpaths(true, true);
        } else if (paintOp === OPS.endPath) {
          flushSubpaths(false, false);
        }
      };

      if (typeof subOpsRaw === 'number') {
        // pdfjs-dist v5+ format: args[0] is paintOp, args[1] is [Float32Array] of interleaved DrawOPS (0..4)
        const buffers: ArrayLike<number>[] = [];
        if (Array.isArray(coordsContainer)) {
          for (const entry of coordsContainer) {
            if (entry && (Array.isArray(entry) || ArrayBuffer.isView(entry))) {
              buffers.push(entry as ArrayLike<number>);
            }
          }
        } else if (coordsContainer && ArrayBuffer.isView(coordsContainer)) {
          buffers.push(coordsContainer as unknown as ArrayLike<number>);
        }

        for (const buf of buffers) {
          let k = 0;
          while (k < buf.length) {
            const drawOp = buf[k++];
            if (drawOp === 0) {
              // DrawOPS.moveTo
              k = pushPathOp(OPS.moveTo, buf as unknown as number[], k);
            } else if (drawOp === 1) {
              // DrawOPS.lineTo
              k = pushPathOp(OPS.lineTo, buf as unknown as number[], k);
            } else if (drawOp === 2) {
              // DrawOPS.curveTo
              k = pushPathOp(OPS.curveTo, buf as unknown as number[], k);
            } else if (drawOp === 3) {
              // DrawOPS.quadraticCurveTo: convert quadratic (P0, CP, P2) -> cubic
              const curSub = activeSubpaths[activeSubpaths.length - 1];
              if (curSub && curSub.points.length > 0 && k + 3 < buf.length) {
                const p0 = curSub.points[curSub.points.length - 1];
                const cp = transformPoint(ctm, buf[k], buf[k + 1], pageHeight);
                const p2 = transformPoint(ctm, buf[k + 2], buf[k + 3], pageHeight);
                const c1: [number, number] = [
                  p0[0] + (2 / 3) * (cp[0] - p0[0]),
                  p0[1] + (2 / 3) * (cp[1] - p0[1]),
                ];
                const c2: [number, number] = [
                  p2[0] + (2 / 3) * (cp[0] - p2[0]),
                  p2[1] + (2 / 3) * (cp[1] - p2[1]),
                ];
                curSub.hasCurve = true;
                curSub.points.push(...sampleCubicBezier(p0, c1, c2, p2));
              }
              k += 4;
            } else if (drawOp === 4) {
              // DrawOPS.closePath
              pushPathOp(OPS.closePath, [], 0);
            } else {
              break;
            }
          }
        }
        applyPaintOp(subOpsRaw);
      } else {
        // Legacy pdfjs v3/v4 format: args[0] is OPS[], args[1] is [coords]
        const subOps = Array.isArray(subOpsRaw) ? (subOpsRaw as number[]) : [];
        let flatCoords: number[] = [];
        if (Array.isArray(coordsContainer)) {
          if (
            coordsContainer.length > 0 &&
            (Array.isArray(coordsContainer[0]) || ArrayBuffer.isView(coordsContainer[0]))
          ) {
            flatCoords = Array.from(coordsContainer[0] as ArrayLike<number>);
          } else {
            flatCoords = coordsContainer.map(Number);
          }
        } else if (coordsContainer && ArrayBuffer.isView(coordsContainer)) {
          flatCoords = Array.from(coordsContainer as unknown as ArrayLike<number>);
        }
        let offset = 0;
        for (const sop of subOps) {
          offset = pushPathOp(sop, flatCoords, offset);
        }
      }
    } else if (
      fn === OPS.moveTo ||
      fn === OPS.lineTo ||
      fn === OPS.curveTo ||
      fn === OPS.curveTo2 ||
      fn === OPS.curveTo3 ||
      fn === OPS.rectangle ||
      fn === OPS.closePath
    ) {
      pushPathOp(fn, args.map(Number), 0);
    } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
      if (fn === OPS.closeStroke && currentSubpath) {
        pushPathOp(OPS.closePath, [], 0);
      }
      flushSubpaths(false, true);
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      flushSubpaths(true, false);
    } else if (
      fn === OPS.fillStroke ||
      fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke ||
      fn === OPS.closeEOFillStroke
    ) {
      if (fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
        pushPathOp(OPS.closePath, [], 0);
      }
      flushSubpaths(true, true);
    } else if (fn === OPS.endPath) {
      flushSubpaths(false, false);
    }
  }

  if (collectedPaths.length === 0) return [];

  // Cluster paths spatially into discrete figure regions
  const pad = 22;
  interface Cluster {
    paths: RawVectorPath[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  const clusters: Cluster[] = [];
  for (const p of collectedPaths) {
    let target: Cluster | null = null;
    for (const c of clusters) {
      if (
        p.minX <= c.maxX + pad &&
        p.maxX >= c.minX - pad &&
        p.minY <= c.maxY + pad &&
        p.maxY >= c.minY - pad
      ) {
        target = c;
        break;
      }
    }
    if (!target) {
      clusters.push({
        paths: [p],
        minX: p.minX,
        minY: p.minY,
        maxX: p.maxX,
        maxY: p.maxY,
      });
    } else {
      target.paths.push(p);
      target.minX = Math.min(target.minX, p.minX);
      target.minY = Math.min(target.minY, p.minY);
      target.maxX = Math.max(target.maxX, p.maxX);
      target.maxY = Math.max(target.maxY, p.maxY);
    }
  }

  // Iteratively merge overlapping clusters
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];
        if (
          a.minX <= b.maxX + pad &&
          a.maxX >= b.minX - pad &&
          a.minY <= b.maxY + pad &&
          a.maxY >= b.minY - pad
        ) {
          a.paths.push(...b.paths);
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          clusters.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // Convert top-down text tokens once
  const topDownTokens = textTokens
    .map((t) => ({
      str: t.str.trim(),
      x: t.x,
      y: pageHeight - t.y,
      w: t.w,
      h: t.h,
    }))
    .filter((t) => t.str.length > 0);

  const diagrams: ExtractedDiagramAsset[] = [];

  for (const cluster of clusters) {
    if (diagrams.length >= 6) break;
    const cw = cluster.maxX - cluster.minX;
    const ch = cluster.maxY - cluster.minY;
    if (cw < 24 || ch < 20) continue;

    const totalSegments = cluster.paths.reduce(
      (sum, p) => sum + Math.max(1, p.points.length - 1),
      0
    );
    const hasNonAxisOrCurve = cluster.paths.some((p) => !p.isAxisAligned || p.hasCurve);

    // Filter out rectangular page-wide table grids containing multi-row prose
    const innerTokens = topDownTokens.filter(
      (t) =>
        t.x + t.w >= cluster.minX - 6 &&
        t.x <= cluster.maxX + 6 &&
        t.y >= cluster.minY - 10 &&
        t.y <= cluster.maxY + 14
    );
    const distinctRows = new Set(innerTokens.map((t) => Math.round(t.y / 9))).size;
    const avgTokenLen =
      innerTokens.length > 0
        ? innerTokens.reduce((s, t) => s + t.str.length, 0) / innerTokens.length
        : 0;
    const looksLikeTableGridOnly =
      !hasNonAxisOrCurve &&
      distinctRows >= 2 &&
      innerTokens.length >= 4 &&
      (avgTokenLen > 5 || cluster.paths.length >= 5);

    if (looksLikeTableGridOnly) continue;
    if (!hasNonAxisOrCurve && totalSegments < 3 && cluster.paths.length < 2) continue;

    // Include adjacent short vertex / axis labels inside or tightly bordering the figure
    const labelMargin = 20;
    const nearbyLabels = topDownTokens.filter(
      (t) =>
        t.str.length <= 28 &&
        t.x + t.w >= cluster.minX - labelMargin &&
        t.x <= cluster.maxX + labelMargin &&
        t.y >= cluster.minY - labelMargin &&
        t.y <= cluster.maxY + labelMargin
    );

    let boxMinX = cluster.minX;
    let boxMinY = cluster.minY;
    let boxMaxX = cluster.maxX;
    let boxMaxY = cluster.maxY;
    for (const lbl of nearbyLabels) {
      boxMinX = Math.min(boxMinX, lbl.x);
      boxMinY = Math.min(boxMinY, lbl.y - lbl.h);
      boxMaxX = Math.max(boxMaxX, lbl.x + Math.max(lbl.w, 8));
      boxMaxY = Math.max(boxMaxY, lbl.y + 4);
    }

    const viewPad = 14;
    const originX = boxMinX - viewPad;
    const originY = boxMinY - viewPad;
    const sceneWidth = Math.max(40, Math.round(boxMaxX - boxMinX + viewPad * 2));
    const sceneHeight = Math.max(40, Math.round(boxMaxY - boxMinY + viewPad * 2));

    const polylines = cluster.paths.slice(0, 120).map((p) => ({
      points: p.points.map(([x, y]) => [
        Number((x - originX).toFixed(1)),
        Number((y - originY).toFixed(1)),
      ] as [number, number]),
      closed: p.closed,
      dashed: p.dashed,
      fill: p.fill,
    }));

    const labels =
      nearbyLabels.length > 0
        ? nearbyLabels.slice(0, 40).map((lbl) => ({
            x: Number((lbl.x - originX).toFixed(1)),
            y: Number((lbl.y - originY).toFixed(1)),
            text: lbl.str,
            fontSize: Math.max(9, Math.min(16, Math.round(lbl.h || 11))),
          }))
        : undefined;

    const structured = analyzeVectorDiagramSemantics({
      paths: cluster.paths,
      originX,
      originY,
      labels: labels ?? [],
    });

    const vectorScene: VectorDiagramScene = {
      width: sceneWidth,
      height: sceneHeight,
      diagramType: structured.diagramType,
      nodes: structured.nodes.length > 0 ? structured.nodes : undefined,
      edges: structured.edges.length > 0 ? structured.edges : undefined,
      measurements: structured.measurements.length > 0 ? structured.measurements : undefined,
      polylines,
      labels,
    };

    const labelSummary = nearbyLabels
      .slice(0, 4)
      .map((l) => l.str)
      .join(', ');

    diagrams.push({
      id: `vec-fig-${pageNumber}-${diagrams.length + 1}`,
      pageNumber,
      caption: labelSummary
        ? `Drawn figure ${diagrams.length + 1} (${labelSummary}) · Page ${pageNumber}`
        : `Drawn geometric figure ${diagrams.length + 1} · Page ${pageNumber}`,
      kind: structured.diagramType === 'math_graph' ? 'chart' : 'diagram',
      diagramType: structured.diagramType,
      width: sceneWidth,
      height: sceneHeight,
      bbox: {
        x: Math.max(0, Math.round(originX)),
        y: Math.max(0, Math.round(originY)),
        width: sceneWidth,
        height: sceneHeight,
      },
      vectorScene,
      extractedNodes: structured.nodes.length > 0 ? structured.nodes : undefined,
      extractedEdges: structured.edges.length > 0 ? structured.edges : undefined,
      extractedMeasurements:
        structured.measurements.length > 0 ? structured.measurements : undefined,
      extractedLabels:
        nearbyLabels.length > 0 ? nearbyLabels.slice(0, 30).map((l) => l.str) : undefined,
    });
  }

  return diagrams;
}

const MEASUREMENT_REGEX =
  /\b\d+(?:\.\d+)?\s*(?:cm|mm|km|m|Ω|ohms?|kΩ|MΩ|V|mV|kV|A|mA|µA|Hz|kHz|MHz|W|kW|N|kN|J|kJ|Pa|kPa|kg|g|°|deg|rad)\b/gi;

function extractMeasurementsFromStrings(strings: string[]): string[] {
  const found = new Set<string>();
  for (const s of strings) {
    const matches = s.match(MEASUREMENT_REGEX);
    if (matches) {
      for (const m of matches) found.add(m.trim());
    }
  }
  return Array.from(found).slice(0, 20);
}

export function classifyDiagramTypeFromSignals(params: {
  joinedLabels: string;
  rectCount: number;
  diamondCount: number;
  circleCount: number;
  triangleCount: number;
  dashedCount: number;
  directedCount: number;
  axisAlignedCount: number;
  totalPaths: number;
}): DiagramSemanticType {
  const txt = params.joinedLabels.toLowerCase();

  if (/\b(<<class>>|<<interface>>|\+\s*\w+\s*\(|-\s*\w+\s*:|class\s+diagram)\b/i.test(txt)) {
    return 'uml_class';
  }
  if (/\b(sequence\s+diagram|alt|loop|opt|participant|actor)\b/i.test(txt) && params.dashedCount >= 2) {
    return 'uml_sequence';
  }
  if (/\b(<<include>>|<<extend>>|use\s+case)\b/i.test(txt)) {
    return 'uml_use_case';
  }
  if (/\b(1\.\.n|0\.\.n|1:n|m:n|entity|primary\s+key|foreign\s+key|pk|fk)\b/i.test(txt)) {
    return 'erd';
  }
  if (/\b(resistor|capacitor|inductor|diode|transistor|vcc|gnd|ohm|volt|amp|circuit|switch)\b/i.test(txt) || /[Ωµ]/.test(params.joinedLabels)) {
    return 'circuit';
  }
  if (/\b(router|switch|lan|wan|subnet|ip|node|topology|packet|server|gateway|firewall)\b/i.test(txt)) {
    return 'network';
  }
  if (/\b(f\(x\)|y\s*=|x-axis|y-axis|origin|slope|gradient|plot|histogram|frequency)\b/i.test(txt)) {
    return 'math_graph';
  }
  if (/\b(cell|nucleus|mitochondria|xylem|phloem|organ|membrane|specimen|apparatus|beaker|burette)\b/i.test(txt)) {
    return 'scientific_illustration';
  }
  if (/\b(beam|load|truss|torque|cross[\s-]section|tolerance|blueprint|elevation|isometric)\b/i.test(txt)) {
    return 'engineering';
  }
  if (/\b(start|end|decision|yes|no|process|flowchart|if\s+|then)\b/i.test(txt) || (params.diamondCount >= 1 && params.directedCount >= 1)) {
    return 'flowchart';
  }
  if (params.triangleCount >= 1 || /\b(angle|triangle|circle|radius|diameter|chord|tangent|θ|∠)\b/i.test(txt)) {
    return 'geometric';
  }
  if (params.rectCount >= 2 && params.directedCount >= 1) {
    return 'flowchart';
  }
  if (params.dashedCount >= 2 && params.rectCount >= 2) {
    return 'uml_sequence';
  }
  if (params.circleCount >= 2 && params.totalPaths >= 4 && params.axisAlignedCount < params.totalPaths) {
    return 'network';
  }
  return 'general_diagram';
}

function analyzeVectorDiagramSemantics(params: {
  paths: RawVectorPath[];
  originX: number;
  originY: number;
  labels: Array<{ x: number; y: number; text: string }>;
}): {
  diagramType: DiagramSemanticType;
  nodes: DiagramNodeItem[];
  edges: DiagramEdgeItem[];
  measurements: string[];
} {
  const nodes: DiagramNodeItem[] = [];
  const edges: DiagramEdgeItem[] = [];
  let rectCount = 0;
  let diamondCount = 0;
  let circleCount = 0;
  let triangleCount = 0;
  let dashedCount = 0;
  let axisAlignedCount = 0;

  for (let idx = 0; idx < params.paths.length; idx += 1) {
    const p = params.paths[idx];
    if (p.dashed) dashedCount += 1;
    if (p.isAxisAligned) axisAlignedCount += 1;
    const w = p.maxX - p.minX;
    const h = p.maxY - p.minY;
    const relBbox = {
      x: Number((p.minX - params.originX).toFixed(1)),
      y: Number((p.minY - params.originY).toFixed(1)),
      width: Number(w.toFixed(1)),
      height: Number(h.toFixed(1)),
    };

    const vertexCount =
      p.closed && p.points.length >= 2 &&
      Math.hypot(p.points[0][0] - p.points[p.points.length - 1][0], p.points[0][1] - p.points[p.points.length - 1][1]) < 2
        ? p.points.length - 1
        : p.points.length;

    if (p.closed && w >= 12 && h >= 10) {
      let shape: DiagramNodeItem['shape'] = 'unknown';
      if (p.hasCurve && Math.abs(w - h) <= Math.max(w, h) * 0.25) {
        shape = 'circle';
        circleCount += 1;
      } else if (p.hasCurve) {
        shape = 'oval';
        circleCount += 1;
      } else if (vertexCount === 3) {
        shape = 'triangle';
        triangleCount += 1;
      } else if (vertexCount === 4) {
        if (p.isAxisAligned) {
          shape = 'rectangle';
          rectCount += 1;
        } else {
          shape = 'diamond';
          diamondCount += 1;
        }
      }

      const insideLabels = params.labels
        .filter(
          (l) =>
            l.x >= relBbox.x - 4 &&
            l.x <= relBbox.x + relBbox.width + 6 &&
            l.y >= relBbox.y - 4 &&
            l.y <= relBbox.y + relBbox.height + 6
        )
        .map((l) => l.text)
        .join(' ')
        .trim();

      nodes.push({
        id: `node-${nodes.length + 1}`,
        shape,
        label: insideLabels || undefined,
        bbox: relBbox,
      });
    } else if (!p.closed && p.points.length >= 2) {
      const startPt = p.points[0];
      const endPt = p.points[p.points.length - 1];
      const len = Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]);
      if (len >= 10) {
        edges.push({
          id: `edge-${edges.length + 1}`,
          directed: false,
          dashed: p.dashed,
          points: p.points.map(([x, y]) => [
            Number((x - params.originX).toFixed(1)),
            Number((y - params.originY).toFixed(1)),
          ]),
        });
      }
    }
  }

  // Link small closed triangles near open edge endpoints as directed arrowheads
  let directedCount = 0;
  for (const edge of edges) {
    const end = edge.points[edge.points.length - 1];
    const start = edge.points[0];
    const nearArrowHead = nodes.some(
      (n) =>
        n.shape === 'triangle' &&
        n.bbox.width < 18 &&
        n.bbox.height < 18 &&
        (Math.hypot(n.bbox.x - end[0], n.bbox.y - end[1]) < 16 ||
          Math.hypot(n.bbox.x - start[0], n.bbox.y - start[1]) < 16)
    );
    if (nearArrowHead) {
      edge.directed = true;
      directedCount += 1;
    }

    // Attach fromNodeId / toNodeId strictly when endpoints terminate near node boxes
    const findNearNode = (pt: [number, number]) =>
      nodes.find(
        (n) =>
          pt[0] >= n.bbox.x - 10 &&
          pt[0] <= n.bbox.x + n.bbox.width + 10 &&
          pt[1] >= n.bbox.y - 10 &&
          pt[1] <= n.bbox.y + n.bbox.height + 10
      );
    edge.fromNodeId = findNearNode(start)?.id;
    edge.toNodeId = findNearNode(end)?.id;
  }

  const labelStrings = params.labels.map((l) => l.text);
  const measurements = extractMeasurementsFromStrings(labelStrings);
  const diagramType = classifyDiagramTypeFromSignals({
    joinedLabels: labelStrings.join(' '),
    rectCount,
    diamondCount,
    circleCount,
    triangleCount,
    dashedCount,
    directedCount,
    axisAlignedCount,
    totalPaths: params.paths.length,
  });

  return { diagramType, nodes, edges, measurements };
}

/**
 * Repairs 1-2px gaps in faint/broken pen or pencil strokes and whitens shaded background
 * inside a cropped raster diagram region so shapes render completely drawn on crisp white.
 */
function completeAndCrispShapeRegion(
  srcGray: Uint8Array,
  srcW: number,
  x0: number,
  y0: number,
  cropW: number,
  cropH: number
): Uint8Array {
  const out = new Uint8Array(cropW * cropH);
  // Estimate local background via bright 80th percentile of crop
  const hist = new Uint32Array(256);
  for (let y = 0; y < cropH; y += 1) {
    const off = (y0 + y) * srcW + x0;
    for (let x = 0; x < cropW; x += 1) {
      hist[srcGray[off + x]] += 1;
    }
  }
  const target = Math.floor(cropW * cropH * 0.82);
  let acc = 0;
  let bgLevel = 245;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= target) {
      bgLevel = Math.max(150, v);
      break;
    }
  }

  const inkMask = new Uint8Array(cropW * cropH);
  const darkCutoff = Math.min(215, Math.max(85, bgLevel - 28));
  for (let y = 0; y < cropH; y += 1) {
    const srcOff = (y0 + y) * srcW + x0;
    const dstOff = y * cropW;
    for (let x = 0; x < cropW; x += 1) {
      const val = srcGray[srcOff + x];
      if (val < darkCutoff) {
        inkMask[dstOff + x] = 1;
        const scaled = Math.max(0, Math.min(180, Math.round(((val - 20) / Math.max(1, darkCutoff - 20)) * 95)));
        out[dstOff + x] = scaled;
      } else {
        out[dstOff + x] = 255;
      }
    }
  }

  // Directional 1-2px gap closure: connects broken thin drawn lines cleanly without bloating blocks
  for (let y = 1; y < cropH - 1; y += 1) {
    const row = y * cropW;
    for (let x = 1; x < cropW - 1; x += 1) {
      const idx = row + x;
      if (inkMask[idx] === 1) continue;
      const horiz = inkMask[idx - 1] && inkMask[idx + 1];
      const vert = inkMask[idx - cropW] && inkMask[idx + cropW];
      const diag1 = inkMask[idx - cropW - 1] && inkMask[idx + cropW + 1];
      const diag2 = inkMask[idx - cropW + 1] && inkMask[idx + cropW - 1];
      if (horiz || vert || diag1 || diag2) {
        out[idx] = 28;
      }
    }
  }

  return out;
}

/**
 * Detects drawn shapes, geometric diagrams, circuit schematics, and graphs in a raster
 * grayscale page image (PNG/JPG/WEBP or scanned PDF), crops them with label margins,
 * bridges broken line strokes, and encodes crisp PNG diagram assets.
 */
export async function extractRasterDiagramsFromGrayscale(params: {
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  maxFigures?: number;
  wordBoxes?: Array<{ text: string; x0: number; y0: number; x1: number; y1: number }>;
  ocrText?: string;
}): Promise<ExtractedDiagramAsset[]> {
  const { gray, width, height, pageNumber, maxFigures = 4, wordBoxes, ocrText } = params;
  if (width < 120 || height < 120 || gray.length < width * height) return [];

  const scale = Math.min(1, 420 / width);
  const aw = Math.max(40, Math.round(width * scale));
  const ah = Math.max(40, Math.round(height * scale));
  const smallInk = new Uint8Array(aw * ah);

  // Sample local intensity + adaptive ink mask on downsampled grid
  let sum = 0;
  for (let y = 0; y < ah; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < aw; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      sum += gray[sy * width + sx];
    }
  }
  const meanBg = sum / (aw * ah);
  const inkThresh = Math.min(215, Math.max(85, meanBg - 26));

  for (let y = 0; y < ah; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    const syNext = Math.min(height - 1, sy + 1);
    for (let x = 0; x < aw; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sxNext = Math.min(width - 1, sx + 1);
      // Min-pool 2x2 neighborhood so 1px drawn lines survive downsampling cleanly
      const minVal = Math.min(
        gray[sy * width + sx],
        gray[sy * width + sxNext],
        gray[syNext * width + sx],
        gray[syNext * width + sxNext]
      );
      if (minVal < inkThresh) {
        smallInk[y * aw + x] = 1;
      }
    }
  }

  // Bridge tiny 1px stroke breaks before connected-component labeling
  const bridged = new Uint8Array(aw * ah);
  for (let y = 1; y < ah - 1; y += 1) {
    const row = y * aw;
    for (let x = 1; x < aw - 1; x += 1) {
      const idx = row + x;
      if (smallInk[idx]) {
        bridged[idx] = 1;
        continue;
      }
      const neighbors =
        smallInk[idx - 1] +
        smallInk[idx + 1] +
        smallInk[idx - aw] +
        smallInk[idx + aw] +
        smallInk[idx - aw - 1] +
        smallInk[idx - aw + 1] +
        smallInk[idx + aw - 1] +
        smallInk[idx + aw + 1];
      if (neighbors >= 2) bridged[idx] = 1;
    }
  }

  const visited = new Uint8Array(aw * ah);
  interface CompBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
  }
  const rawComps: CompBox[] = [];
  const queue = new Int32Array(aw * ah);

  for (let start = 0; start < aw * ah; start += 1) {
    if (!bridged[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let minX = aw;
    let minY = ah;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    while (head < tail) {
      const idx = queue[head++];
      const cx = idx % aw;
      const cy = (idx - cx) / aw;
      area += 1;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= ah) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= aw) continue;
          const nIdx = ny * aw + nx;
          if (bridged[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }
    }

    rawComps.push({ minX, minY, maxX, maxY, area });
  }

  // Filter for real 2D drawn shapes/figures (exclude small text glyphs, page frames, thin horizontal rules)
  const figureBoxes: CompBox[] = [];
  for (const c of rawComps) {
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    if (cw < Math.max(26, aw * 0.08) || ch < Math.max(22, ah * 0.045)) continue;
    if (cw > aw * 0.88 && ch > ah * 0.88) continue;
    if ((ch <= 4 && cw > aw * 0.22) || (cw <= 4 && ch > ah * 0.22)) continue;
    const fillRatio = c.area / (cw * ch);
    // Line drawings / geometric diagrams have 0.015..0.68 ink occupancy inside bounding box
    if (fillRatio < 0.015 || fillRatio > 0.68) continue;
    figureBoxes.push({ ...c });
  }

  if (figureBoxes.length === 0) return [];

  // Attach nearby small label components (e.g. A, B, C, theta) within 14px on analysis scale
  const labelPad = 14;
  for (const fig of figureBoxes) {
    for (const c of rawComps) {
      const cw = c.maxX - c.minX + 1;
      const ch = c.maxY - c.minY + 1;
      if (cw > 34 || ch > 22) continue;
      if (
        c.minX <= fig.maxX + labelPad &&
        c.maxX >= fig.minX - labelPad &&
        c.minY <= fig.maxY + labelPad &&
        c.maxY >= fig.minY - labelPad
      ) {
        fig.minX = Math.min(fig.minX, c.minX);
        fig.minY = Math.min(fig.minY, c.minY);
        fig.maxX = Math.max(fig.maxX, c.maxX);
        fig.maxY = Math.max(fig.maxY, c.maxY);
      }
    }
  }

  // Merge overlapping figure boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < figureBoxes.length; i += 1) {
      for (let j = i + 1; j < figureBoxes.length; j += 1) {
        const a = figureBoxes[i];
        const b = figureBoxes[j];
        if (
          a.minX <= b.maxX + 10 &&
          a.maxX >= b.minX - 10 &&
          a.minY <= b.maxY + 10 &&
          a.maxY >= b.minY - 10
        ) {
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          a.area += b.area;
          figureBoxes.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // Sort top-to-bottom and encode crisp stroke-completed PNG crops + raw original reference crop
  figureBoxes.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const outDiagrams: ExtractedDiagramAsset[] = [];

  for (const box of figureBoxes.slice(0, maxFigures)) {
    const padPx = Math.max(16, Math.round(width * 0.015));
    const rx0 = Math.max(0, Math.floor(box.minX / scale) - padPx);
    const ry0 = Math.max(0, Math.floor(box.minY / scale) - padPx);
    const rx1 = Math.min(width - 1, Math.ceil(box.maxX / scale) + padPx);
    const ry1 = Math.min(height - 1, Math.ceil(box.maxY / scale) + padPx);
    const cropW = rx1 - rx0 + 1;
    const cropH = ry1 - ry0 + 1;
    if (cropW < 40 || cropH < 32) continue;

    // Preserve unedited original crop reference
    const rawCrop = new Uint8Array(cropW * cropH);
    for (let y = 0; y < cropH; y += 1) {
      const srcOff = (ry0 + y) * width + rx0;
      rawCrop.set(gray.subarray(srcOff, srcOff + cropW), y * cropW);
    }

    const cleanCrop = completeAndCrispShapeRegion(gray, width, rx0, ry0, cropW, cropH);
    const [encoded, origEncoded] = await Promise.all([
      encodeGrayToPngDataUrl(cleanCrop, cropW, cropH),
      encodeGrayToPngDataUrl(rawCrop, cropW, cropH),
    ]);

    const insideLabels = (wordBoxes ?? [])
      .filter((w) => {
        const cx = (w.x0 + w.x1) / 2;
        const cy = (w.y0 + w.y1) / 2;
        return cx >= rx0 && cx <= rx1 && cy >= ry0 && cy <= ry1;
      })
      .map((w) => w.text.trim())
      .filter(Boolean);

    const extractedMeasurements = extractMeasurementsFromStrings([
      ...insideLabels,
      ...(ocrText ? [ocrText] : []),
    ]);

    const diagramType = classifyDiagramTypeFromSignals({
      joinedLabels: [...insideLabels, ocrText ?? ''].join(' '),
      rectCount: 1,
      diamondCount: 0,
      circleCount: 0,
      triangleCount: 0,
      dashedCount: 0,
      directedCount: 0,
      axisAlignedCount: 1,
      totalPaths: 4,
    });

    outDiagrams.push({
      id: `fig-${pageNumber}-${outDiagrams.length + 1}`,
      pageNumber,
      caption: `Drawn figure / diagram ${outDiagrams.length + 1} · Page ${pageNumber}`,
      kind: diagramType === 'math_graph' ? 'chart' : 'diagram',
      diagramType,
      mimeType: 'image/png',
      dataUrl: encoded.dataUrl,
      originalCropDataUrl: origEncoded.dataUrl,
      width: cropW,
      height: cropH,
      bbox: { x: rx0, y: ry0, width: cropW, height: cropH },
      extractedMeasurements:
        extractedMeasurements.length > 0 ? extractedMeasurements : undefined,
      extractedLabels: insideLabels.length > 0 ? insideLabels.slice(0, 30) : undefined,
    });
  }

  return outDiagrams;
}

