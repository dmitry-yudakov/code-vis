import { describe, expect, it } from 'vitest';
import { Matrix4, Ray, Vector3 } from 'three';
import {
  defaultImmersiveLayout, immersiveViewKey, PANEL_ANGLES, PANEL_BOUNDS, PANEL_IDS, PANEL_SIZES,
  parseImmersiveLayout, parseImmersiveLayouts, parsePanelAction, updateImmersivePanel, panelTransform, placeImmersivePanel,
} from '@/features/shell/immersive/workspaceLayout';
import { dragPanelPlacement, startPanelDrag } from '@/features/shell/immersive/panelDrag';
import { EVIDENCE_COLUMNS, EVIDENCE_LINES_PER_PAGE, evidencePages, workspaceTextLines } from '@/features/shell/immersive/workspaceText';
import { immersiveChatLines, immersiveMessageEntry } from '@/features/diagram/spatial/immersiveTranscript';
import { allocateTexturePixels } from '@/features/diagram/spatial/spatialModel';
import type { ChatMessage } from '@/shared/types';

describe('immersive device layout', () => {
  it('round-trips deliberate layout with machine-qualified identity, ignoring tracking and unknown state', () => {
    const key = immersiveViewKey('home', 'project', 'session');
    const remote = immersiveViewKey('remote', 'project', 'session');
    let layout = placeImmersivePanel(defaultImmersiveLayout(), 'canvas', { angle: 12.5, height: 0.1, distance: 3 });
    layout = updateImmersivePanel(layout, 'conversation', 'close');
    const parsed = parseImmersiveLayouts(JSON.stringify({ version: 5, views: { [key]: { ...layout, tracking: [1, 2, 3] } } }));
    expect(parsed.views[key]).toEqual(layout);
    expect(parsed.views[remote]).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('tracking');
    expect(updateImmersivePanel(layout, 'conversation', 'open').focused).toBe('conversation');
    expect(layout.panels.conversation.open).toBe(false);
  });

  it('migrates old slot placements and continuous scales to angles and the nearest preset', () => {
    const key = immersiveViewKey('home', 'project', 'session');
    const legacyIds = ['conversation', 'canvas', 'evidence'] as const;
    const legacy = { focused: 'evidence', panels: Object.fromEntries(legacyIds.map((id, index) => [id,
      { slot: 3 - index, height: 0.1, distance: 3, scale: 0.85, open: true },
    ])) };
    const parsed = parseImmersiveLayouts(JSON.stringify({ version: 1, views: { [key]: legacy } }));
    expect(parsed.version).toBe(5);
    expect(parsed.views[key].focused).toBeUndefined();
    for (const [index, id] of legacyIds.entries()) expect(parsed.views[key].panels[id]).toEqual({
      angle: [-57, -19, 19, 57][3 - index], height: 0.1, distance: 3, size: 'small', open: id !== 'evidence',
    });
    expect(parsed.views[key].panels.arena).toEqual(defaultImmersiveLayout().panels.arena);
    legacy.panels.canvas.slot = legacy.panels.evidence.slot;
    expect(parseImmersiveLayout(legacy, 1)).toEqual(defaultImmersiveLayout());
  });

  it('recovers missing, corrupt, future-version and non-finite layouts and clamps saved placement', () => {
    for (const raw of [null, '{broken', '{"version":6,"views":{}}', 'null']) expect(parseImmersiveLayouts(raw)).toEqual({ version: 5, views: {} });
    const invalid = defaultImmersiveLayout();
    invalid.panels.canvas.angle = NaN;
    expect(parseImmersiveLayout(invalid)).toEqual(defaultImmersiveLayout());
    expect(parseImmersiveLayout({ panels: { ...defaultImmersiveLayout().panels,
      canvas: { angle: 12, height: 0, distance: 3, size: 'unknown', open: true },
    } })).toEqual(defaultImmersiveLayout());
    const outside = defaultImmersiveLayout();
    outside.panels.canvas = { angle: 999, height: -999, distance: 0, size: 'extra-large', open: true };
    expect(parseImmersiveLayout(outside).panels.canvas).toEqual({ angle: 65, height: -0.3, distance: 2, size: 'extra-large', open: true });
  });

  it('moves old defaults to chat-right/canvas-center and hides changes while retaining deliberate placement', () => {
    const key = immersiveViewKey('home', 'project', 'session');
    const legacy = { focused: 'canvas', panels: Object.fromEntries(['sessions', 'conversation', 'canvas', 'evidence'].map((id, slot) => [id,
      { angle: [-57, -19, 19, 57][slot], slot, scale: 1, height: 0, distance: 2.6, size: 'medium', open: true },
    ])) };
    const read = () => parseImmersiveLayouts(JSON.stringify({ version: 2, views: { [key]: legacy } })).views[key];
    expect(read()).toEqual(defaultImmersiveLayout());
    expect(parseImmersiveLayouts(JSON.stringify({ version: 1, views: { [key]: legacy } })).views[key]).toEqual(defaultImmersiveLayout());
    legacy.panels.conversation.angle = -44;
    expect(read().panels.conversation.angle).toBe(-44);
    expect(read().panels.canvas.angle).toBe(18);
    expect(read().panels.evidence.open).toBe(false);
    const opened = updateImmersivePanel(read(), 'evidence', 'open');
    expect(parseImmersiveLayouts(JSON.stringify({ version: 5, views: { [key]: opened } })).views[key].panels.evidence.open).toBe(true);
  });

  it('migrates version 3 default positions while preserving moved panels and visibility choices', () => {
    const key = immersiveViewKey('home', 'project', 'session');
    const previous = defaultImmersiveLayout();
    previous.panels.conversation.angle = -36;
    previous.panels.evidence.angle = 36;
    const read = () => parseImmersiveLayouts(JSON.stringify({ version: 3, views: { [key]: previous } }));
    expect(read()).toEqual({ version: 5, views: { [key]: defaultImmersiveLayout() } });
    previous.panels.conversation.height = 0.1;
    previous.panels.evidence.open = true;
    expect(read().views[key].panels.conversation).toEqual(previous.panels.conversation);
    expect(read().views[key].panels.evidence).toEqual({ ...previous.panels.evidence, angle: -18 });
    previous.panels.conversation.height = 0;
    previous.panels.conversation.angle = -44;
    expect(read().views[key].panels.conversation.angle).toBe(-44);
    expect(PANEL_ANGLES).toEqual([-54, 54, 18, -18]);
  });

  it('moves untouched version 4 panels into four non-overlapping positions', () => {
    const key = immersiveViewKey('home', 'project', 'session');
    const previous = defaultImmersiveLayout();
    previous.panels.conversation.angle = 36;
    previous.panels.canvas.angle = 0;
    previous.panels.evidence.angle = -36;
    const parsed = parseImmersiveLayouts(JSON.stringify({ version: 4, views: { [key]: previous } }));
    expect(parsed.views[key]).toEqual(defaultImmersiveLayout());
    previous.panels.evidence.height = 0.1;
    expect(parseImmersiveLayouts(JSON.stringify({ version: 4, views: { [key]: previous } }))
      .views[key].panels.evidence.angle).toBe(-36);
  });

  it('toggles open panels closed and closed panels open without losing their placement', () => {
    const original = placeImmersivePanel(defaultImmersiveLayout(), 'conversation', { angle: 22, height: 0.1, distance: 3.2 });
    const closed = updateImmersivePanel(original, 'conversation', 'toggle');
    expect(closed.panels.conversation).toEqual({ ...original.panels.conversation, open: false });
    expect(closed.focused).toBeUndefined();
    expect(closed.panels.canvas).toBe(original.panels.canvas);
    expect(original.panels.conversation.open).toBe(true);
    expect(updateImmersivePanel(closed, 'conversation', 'toggle')).toEqual(original);
    const evidence = updateImmersivePanel(original, 'evidence', 'toggle');
    expect(evidence.panels.evidence.open).toBe(true);
    expect(evidence.focused).toBe('evidence');
    expect(updateImmersivePanel(evidence, 'conversation', 'toggle').focused).toBe('evidence');
    expect(parsePanelAction('panel:conversation:toggle')).toEqual({ id: 'conversation', command: 'toggle' });
  });

  it('keeps placement forward and bounded without moving other panels or changing placement on resize', () => {
    let layout = defaultImmersiveLayout();
    for (let cycle = 0; cycle < 20; cycle++) {
      for (const id of PANEL_IDS) {
        layout = updateImmersivePanel(layout, id, 'open');
        const before = layout;
        layout = placeImmersivePanel(layout, id, { angle: cycle * 10, height: cycle, distance: 0.1 });
        for (const other of PANEL_IDS.filter((other) => other !== id)) expect(layout.panels[other]).toBe(before.panels[other]);
        const placed = layout.panels[id];
        for (const size of Object.keys(PANEL_SIZES) as Array<keyof typeof PANEL_SIZES>) {
          layout = updateImmersivePanel(layout, id, size);
          expect(layout.panels[id]).toEqual({ ...placed, size });
        }
        layout = updateImmersivePanel(layout, id, 'close');
        expect(placeImmersivePanel(layout, id, { angle: 0, height: 0, distance: 3 })).toBe(layout);
        layout = updateImmersivePanel(layout, id, 'open');
      }
      for (const id of PANEL_IDS) {
        const panel = layout.panels[id];
        expect(panel.distance).toBeGreaterThanOrEqual(PANEL_BOUNDS.distance[0]);
        expect(panel.height).toBeLessThanOrEqual(PANEL_BOUNDS.height[1]);
        expect(panelTransform(panel).position[2]).toBeLessThan(0);
      }
    }
    expect(placeImmersivePanel(layout, 'canvas', { angle: NaN, height: 0, distance: 3 })).toBe(layout);
    expect(updateImmersivePanel(layout, 'canvas', 'focus').panels).toEqual(layout.panels);
  });
});

describe('panel ray dragging', () => {
  it('preserves the initial grab offset, follows pointing, and supports physical push/pull', () => {
    const center = new Vector3(0, 0, -2.8);
    const point = new Vector3(-0.46, 0.59, -2.78);
    const ray = new Ray(new Vector3(0, -0.2, -0.3), point.clone().sub(new Vector3(0, -0.2, -0.3)).normalize());
    const drag = startPanelDrag(ray, point, center, new Matrix4());
    expect(dragPanelPlacement(drag, ray).angle).toBeCloseTo(0);
    expect(dragPanelPlacement(drag, ray).height).toBeCloseTo(0);
    expect(dragPanelPlacement(drag, ray).distance).toBeCloseTo(2.8);
    const moved = ray.clone();
    moved.origin.add(new Vector3(0.3, 0.2, 0.2));
    expect(dragPanelPlacement(drag, moved).height).toBeCloseTo(0.2);
    expect(dragPanelPlacement(drag, moved).angle).toBeGreaterThan(0);
    expect(dragPanelPlacement(drag, moved).distance).toBeLessThan(2.8);
    moved.origin.z -= 0.6;
    expect(dragPanelPlacement(drag, moved).distance).toBeGreaterThan(2.8);
    const beforeRotation = dragPanelPlacement(drag, moved).angle;
    moved.direction.applyAxisAngle(new Vector3(0, 1, 0), -0.1);
    expect(dragPanelPlacement(drag, moved).angle).toBeGreaterThan(beforeRotation);
  });

  it('converts world-space input to a recentered workspace and bounds extreme drags', () => {
    const origin = new Matrix4().makeRotationY(Math.PI / 2).setPosition(1, 1.6, 2);
    const center = new Vector3(0, 0, -2.8).applyMatrix4(origin);
    const point = new Vector3(-0.46, 0.59, -2.78).applyMatrix4(origin);
    const start = new Vector3(0, -0.2, -0.3).applyMatrix4(origin);
    const ray = new Ray(start, point.clone().sub(start).normalize());
    const drag = startPanelDrag(ray, point, center, origin);
    const placed = dragPanelPlacement(drag, ray);
    expect(placed.angle).toBeCloseTo(0);
    expect(placed.height).toBeCloseTo(0);
    expect(placed.distance).toBeCloseTo(2.8);
    ray.origin.add(new Vector3(100, 100, 100));
    expect(dragPanelPlacement(drag, ray)).toEqual({ angle: -65, height: 0.5, distance: 2 });
  });

  it('turns a 10 cm push/pull into 40 cm of depth while preserving lateral and vertical sensitivity', () => {
    // The handle is below the panel; the downward ray must not amplify vertical movement.
    const center = new Vector3(0, 0, -3);
    const point = new Vector3(0, -1.08, -2.98);
    const ray = new Ray(new Vector3(), point.clone().normalize());
    const drag = startPanelDrag(ray, point, center, new Matrix4());
    for (const [motion, distance] of [[-0.1, 3.4], [0.1, 2.6], [-1, 4.5], [1, 2]]) {
      const moved = ray.clone();
      moved.origin.z += motion;
      const placement = dragPanelPlacement(drag, moved);
      expect(placement.distance).toBeCloseTo(distance);
      expect(placement.height).toBeCloseTo(0);
      expect(placement.angle).toBeCloseTo(0);
    }
    const sideways = ray.clone();
    sideways.origin.set(0.1, 0.1, 0);
    const transform = panelTransform({ ...defaultImmersiveLayout().panels.canvas, ...dragPanelPlacement(drag, sideways) });
    expect(transform.position[0]).toBeCloseTo(0.1);
    expect(transform.position[1]).toBeCloseTo(0.1);
    expect(transform.position[2]).toBeCloseTo(-3);
    expect(dragPanelPlacement(drag, ray).distance).toBeCloseTo(3);
  });

  it('keeps an off-center handle under the ray as the panel turns across the workspace', () => {
    const axis = new Vector3(0, 1, 0);
    const panel = { ...defaultImmersiveLayout().panels.canvas, angle: -40, distance: 3 };
    const transform = panelTransform(panel);
    const center = new Vector3(...transform.position);
    const handleOffset = new Vector3(-0.46, 0.59, 0.02);
    const point = handleOffset.clone().applyAxisAngle(axis, transform.rotationY).add(center);
    const ray = new Ray(new Vector3(), point.clone().normalize());
    const drag = startPanelDrag(ray, point, center, new Matrix4());
    ray.direction.applyAxisAngle(axis, -Math.PI / 3);
    const placed = panelTransform({ ...panel, ...dragPanelPlacement(drag, ray) });
    const handle = handleOffset.applyAxisAngle(axis, placed.rotationY).add(new Vector3(...placed.position));
    expect(handle.distanceTo(ray.at(drag.distance, new Vector3()))).toBeLessThan(1e-10);
  });
});

describe('readable workspace text', () => {
  it('rasterizes a small active diagram instead of treating its native short edge as a budget omission', () => {
    const [allocation] = allocateTexturePixels([{ id: 'small', viewBox: [0, 0, 400, 60] }], 'small', 1_100_000);
    expect(allocation.omitted).toBe(false);
    expect(allocation.height).toBeGreaterThanOrEqual(128);
    expect(allocation.pixels).toBeLessThanOrEqual(1_100_000);
  });
  it('wraps complete prose/code without losing long tokens, Unicode or indentation', () => {
    const source = `  const long = '${'🙂'.repeat(2400)}';\n${Array.from({ length: 50 }, (_, i) => `    code line ${i}`).join('\n')}`;
    const message: ChatMessage = { id: 'm', role: 'assistant', authorId: 'a', status: 'complete', createdAt: '', rawMarkdown: source, blocks: [] };
    const entry = immersiveMessageEntry(message, new Map());
    const lines = immersiveChatLines(entry.text);
    expect(lines.length).toBeGreaterThan(50);
    expect(lines).toEqual(immersiveChatLines(source));
    expect(lines[0]).toMatch(/^  const/);
    expect(lines.join('')).toBe(source.replaceAll('\n', ''));
  });
  it('pages both staged and working-tree patches without clipping long lines', () => {
    const staged = `@@ fixture @@\n+${'x'.repeat(160)}`;
    const unstaged = Array.from({ length: 80 }, (_, i) => `-  removed ${i}`).join('\n');
    const pages = evidencePages({ path: 'source.ts', staged, unstaged });
    expect(pages.flat()).toEqual(workspaceTextLines(`Staged\n${staged}\n\nWorking tree\n${unstaged}`));
    expect(pages.every((page) => page.length <= EVIDENCE_LINES_PER_PAGE && page.every((line) => [...line].length <= EVIDENCE_COLUMNS))).toBe(true);
  });
});
