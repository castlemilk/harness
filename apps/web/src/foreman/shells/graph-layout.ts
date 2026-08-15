import type { Harness, Objective } from '../types.js';
import { buildTree, type HarnessNode } from '../data/useForeman.js';

/**
 * Tidy layout for the topology canvas.
 *
 * A classic two-pass tree layout: leaves claim slots left to right, parents
 * centre over their children. Node width and row spacing shrink with depth,
 * matching the wireframe where the objective is a card and a depth-3 harness
 * is a chip.
 */

export interface LaidOutNode {
  id: string;
  harness: Harness | null;
  /** Null for the synthetic objective root. */
  objective: Objective | null;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  childCount: number;
  collapsed: boolean;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: { id: string; from: LaidOutNode; to: LaidOutNode }[];
  width: number;
  height: number;
}

const WIDTH_BY_DEPTH = [190, 154, 130, 104];
const HEIGHT_BY_DEPTH = [54, 48, 40, 30];
const ROW_GAP = [130, 112, 104, 92];
const H_GAP = 26;

function widthAt(depth: number) {
  return WIDTH_BY_DEPTH[Math.min(depth, WIDTH_BY_DEPTH.length - 1)];
}
function heightAt(depth: number) {
  return HEIGHT_BY_DEPTH[Math.min(depth, HEIGHT_BY_DEPTH.length - 1)];
}
function rowY(depth: number) {
  let y = 22;
  for (let d = 0; d < depth; d++) y += ROW_GAP[Math.min(d, ROW_GAP.length - 1)];
  return y;
}

export function layoutGraph(
  objective: Objective,
  harnesses: Harness[],
  collapsed: Set<string>,
): GraphLayout {
  const roots = buildTree(harnesses);
  const nodes: LaidOutNode[] = [];

  // Per-row frontier: the next free x at each depth. Every placement respects
  // its own row's frontier, which is what stops a parent that is wider than its
  // children (a lead with one worker) from backing into its left sibling.
  const frontier: number[] = [];
  const freeAt = (depth: number) => frontier[depth] ?? 0;

  const place = (
    node: HarnessNode,
    depth: number,
    parentId: string | null,
  ): { laid: LaidOutNode; subtree: LaidOutNode[] } => {
    const w = widthAt(depth);
    const isCollapsed = collapsed.has(node.harness.id);
    const kids = isCollapsed ? [] : node.children;

    let x: number;
    let subtree: LaidOutNode[] = [];

    if (kids.length === 0) {
      x = freeAt(depth);
    } else {
      const placed = kids.map((c) => place(c, depth + 1, node.harness.id));
      subtree = placed.flatMap((p) => p.subtree);
      const first = placed[0].laid;
      const last = placed[placed.length - 1].laid;
      // Centre the parent over the span its children occupy…
      const centred = (first.x + (last.x + last.width) - w) / 2;
      const minX = freeAt(depth);
      if (centred < minX) {
        // …but never left of this row's frontier. Slide the whole subtree right
        // so the parent stays centred over its own children.
        const shift = minX - centred;
        for (const n of subtree) n.x += shift;
        for (const n of subtree) {
          frontier[n.depth] = Math.max(freeAt(n.depth), n.x + n.width + H_GAP);
        }
        x = minX;
      } else {
        x = centred;
      }
    }

    const laid: LaidOutNode = {
      id: node.harness.id,
      harness: node.harness,
      objective: null,
      depth,
      x,
      y: rowY(depth + 1),
      width: w,
      height: heightAt(depth),
      parentId,
      childCount: node.harness.childCount || node.children.length,
      collapsed: isCollapsed && node.children.length > 0,
    };
    frontier[depth] = x + w + H_GAP;
    nodes.push(laid);
    return { laid, subtree: [...subtree, laid] };
  };

  const topLevel = roots.map((r) => place(r, 0, 'objective-root').laid);

  const rootWidth = widthAt(0);
  const spanStart = topLevel.length > 0 ? topLevel[0].x : 0;
  const spanEnd =
    topLevel.length > 0
      ? topLevel[topLevel.length - 1].x + topLevel[topLevel.length - 1].width
      : rootWidth;

  const root: LaidOutNode = {
    id: 'objective-root',
    harness: null,
    objective,
    depth: -1,
    x: Math.max(0, (spanStart + spanEnd - rootWidth) / 2),
    y: rowY(0),
    width: rootWidth,
    height: 58,
    parentId: null,
    childCount: topLevel.length,
    collapsed: false,
  };
  nodes.unshift(root);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = nodes.flatMap((n) => {
    if (n.parentId == null) return [];
    const from = byId.get(n.parentId);
    // A parent filtered out of view drops its edge rather than dangling it.
    if (!from) return [];
    return [{ id: `${n.parentId}->${n.id}`, from, to: n }];
  });

  const width = Math.max(...nodes.map((n) => n.x + n.width), 400) + 40;
  const height = Math.max(...nodes.map((n) => n.y + n.height), 300) + 60;

  return { nodes, edges, width, height };
}

/** Cubic bezier from a parent's bottom edge to a child's top edge. */
export function edgePath(from: LaidOutNode, to: LaidOutNode): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const mid = y1 + (y2 - y1) / 2;
  return `M${String(x1)},${String(y1)} C${String(x1)},${String(mid)} ${String(x2)},${String(mid)} ${String(x2)},${String(y2)}`;
}
