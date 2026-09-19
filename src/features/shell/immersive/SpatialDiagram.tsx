import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import type {
  SpatialDiagramEdge, SpatialDiagramGraph, SpatialDiagramNode, SpatialNodePlacement,
} from '@/features/diagram/spatial/spatialDiagramModel';
import { layoutSpatialNodes, spatialDiagramPages } from '@/features/diagram/spatial/spatialDiagramModel';
import { CANVAS_REVIEW_ACTIONS, type CanvasReviewActionName } from './canvasReviewControls';
import { createWorkspaceButtonResource, createWorkspaceLabelResource, createWorkspaceTextResource } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { ControlGroupSurface, WorkspacePager, WorldButton } from './WorkspacePanel';
import { immersiveTheme } from './immersiveTheme';

export interface SpatialDiagramController {
  perform(action: CanvasReviewActionName): void;
}

interface Selection {
  key: string;
  kind: 'node' | 'edge' | 'group';
  id: string;
}

function nodeSize(node: SpatialDiagramNode): [number, number, number] {
  const width = Math.min(0.18, Math.max(0.13, 0.10 + [...node.label].length * 0.0035));
  return [width, node.shape === 'circle' || node.shape === 'ellipse' ? 0.10 : 0.085, 0.045];
}

function SpatialNode({ node, placement, theme, selected, neighbor, onSelect }: {
  node: SpatialDiagramNode;
  placement: SpatialNodePlacement;
  theme: ThemeName;
  selected: boolean;
  neighbor: boolean;
  onSelect(selection: Selection): void;
}) {
  const size = nodeSize(node);
  const resource = useTextureResource((ledger) => {
    const round = node.shape === 'circle' || node.shape === 'ellipse';
    const geometry = round
      ? ledger.trackGeometry(new THREE.CylinderGeometry(size[1] / 2, size[1] / 2, size[2], 32))
      : ledger.trackGeometry(new THREE.BoxGeometry(...size));
    const material = ledger.trackMaterial(new THREE.MeshStandardMaterial({
      color: selected ? immersiveTheme[theme].selected : neighbor ? immersiveTheme[theme].hover : immersiveTheme[theme].raised,
      emissive: selected ? immersiveTheme[theme].link : '#000000', emissiveIntensity: selected ? 0.18 : 0,
      roughness: 0.72, metalness: 0.04,
    }));
    const label = createWorkspaceLabelResource(node.label.replaceAll('\n', ' '), theme, ledger);
    return { geometry, material, label, round };
  }, [node.key, node.label, node.shape, selected, neighbor, theme, ...size]);
  if (!resource) return null;
  return <group name={`Spatial node ${node.id}`} position={placement.position}
    rotation-z={node.shape === 'diamond' ? Math.PI / 4 : 0}
    userData={{ spatialKey: node.key, spatialKind: 'node', elementId: node.id, fullLabel: node.label, groupId: node.groupId,
      selected, neighbor }}>
    <mesh geometry={resource.geometry} material={resource.material}
      rotation-x={resource.round ? Math.PI / 2 : 0}
      scale={resource.round && node.shape === 'ellipse' ? [size[0] / size[1], 1, 1] : 1}
      onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect({ key: node.key, kind: 'node', id: node.id }); }} />
    <mesh name={`Spatial node label ${node.id}`} geometry={resource.label.geometry} material={resource.label.material}
      position={[0, 0, size[2] / 2 + 0.001]} rotation-z={node.shape === 'diamond' ? -Math.PI / 4 : 0}
      scale={[Math.min(1, size[0] / Math.max(0.01, resource.label.width)), 0.7, 1]} pointerEvents="none" raycast={() => undefined} />
  </group>;
}

function SpatialEdgeObject({ edge, start, end, theme, selected, neighbor, onSelect }: {
  edge: SpatialDiagramEdge;
  start: SpatialNodePlacement;
  end: SpatialNodePlacement;
  theme: ThemeName;
  selected: boolean;
  neighbor: boolean;
  onSelect(selection: Selection): void;
}) {
  const vector = useMemo(() => new THREE.Vector3(...end.position).sub(new THREE.Vector3(...start.position)), [start, end]);
  const length = Math.max(0.01, vector.length() - 0.08);
  const midpoint = useMemo(() => new THREE.Vector3(...start.position).add(new THREE.Vector3(...end.position)).multiplyScalar(0.5), [start, end]);
  const rotation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()), [vector]);
  const resource = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(new THREE.CylinderGeometry(0.0045, 0.0045, length, 10)),
    arrow: ledger.trackGeometry(new THREE.ConeGeometry(0.014, 0.035, 12)),
    material: ledger.trackMaterial(new THREE.MeshStandardMaterial({
      color: selected ? immersiveTheme[theme].focus : neighbor ? immersiveTheme[theme].link : immersiveTheme[theme].secondaryText,
      emissive: selected ? immersiveTheme[theme].link : '#000000', emissiveIntensity: selected ? 0.2 : 0,
    })),
    label: edge.label ? createWorkspaceLabelResource(edge.label.replaceAll('\n', ' '), theme, ledger) : undefined,
  }), [edge.key, edge.label, length, selected, neighbor, theme]);
  if (!resource) return null;
  const choose = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect({ key: edge.key, kind: 'edge', id: edge.id }); };
  return <group name={`Spatial edge ${edge.id}`} userData={{ spatialKey: edge.key, spatialKind: 'edge', elementId: edge.id,
    fullLabel: edge.label, start: edge.start, end: edge.end, selected, neighbor }}>
    <mesh name={`Spatial edge body ${edge.id}`} geometry={resource.geometry} material={resource.material} position={midpoint} quaternion={rotation} onClick={choose} />
    <mesh geometry={resource.arrow} material={resource.material} position={new THREE.Vector3(...end.position).lerp(new THREE.Vector3(...start.position), 0.08)}
      quaternion={rotation} onClick={choose} />
    {resource.label && <mesh name={`Spatial edge label ${edge.id}`} geometry={resource.label.geometry} material={resource.label.material}
      position={[midpoint.x, midpoint.y + 0.025, midpoint.z + 0.012]}
      scale={[Math.min(0.75, 0.16 / Math.max(0.01, resource.label.width)), 0.65, 1]} pointerEvents="none" raycast={() => undefined} />}
  </group>;
}

function SpatialGroupObject({ graph, groupId, placements, collapsed, theme, selected, onSelect }: {
  graph: SpatialDiagramGraph;
  groupId: string;
  placements: SpatialNodePlacement[];
  collapsed: boolean;
  theme: ThemeName;
  selected: boolean;
  onSelect(selection: Selection): void;
}) {
  const group = graph.groups.find((candidate) => candidate.id === groupId)!;
  const members = placements.filter((placement) => group.nodeIds.includes(placement.id));
  const center: [number, number, number] = members.length
    ? [members.reduce((sum, item) => sum + item.position[0], 0) / members.length,
      members.reduce((sum, item) => sum + item.position[1], 0) / members.length, 0]
    : [-0.45 + (graph.groups.indexOf(group) % 5) * 0.22, 0.30 - Math.floor(graph.groups.indexOf(group) / 5) * 0.12, 0];
  const width = collapsed ? 0.19 : Math.min(1.18, Math.max(0.24, ...members.map((item) => Math.abs(item.position[0] - center[0]) * 2 + 0.24)));
  const height = collapsed ? 0.09 : Math.min(0.64, Math.max(0.14, ...members.map((item) => Math.abs(item.position[1] - center[1]) * 2 + 0.15)));
  const resource = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(new THREE.BoxGeometry(width, height, 0.014)),
    material: ledger.trackMaterial(new THREE.MeshStandardMaterial({
      color: selected ? immersiveTheme[theme].selected : immersiveTheme[theme].surface,
      transparent: true, opacity: collapsed ? 0.95 : 0.42, roughness: 0.8,
    })),
    label: createWorkspaceLabelResource(`${group.label}${collapsed ? ` (${group.nodeIds.length} hidden)` : ''}`, theme, ledger),
  }), [group.key, group.label, group.nodeIds.length, collapsed, selected, theme, width, height]);
  if (!resource) return null;
  const choose = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect({ key: group.key, kind: 'group', id: group.id }); };
  return <group name={`Spatial group ${group.id}`} position={center}
    userData={{ spatialKey: group.key, spatialKind: 'group', elementId: group.id, fullLabel: group.label,
      memberCount: group.nodeIds.length, collapsed, selected }}>
    <mesh geometry={resource.geometry} material={resource.material} position-z={-0.02}
      onClick={choose} />
    <mesh name={`Spatial group label ${group.id}`} geometry={resource.label.geometry} material={resource.label.material}
      position={[0, height / 2 - 0.025, -0.011]} scale={[Math.min(0.8, width / Math.max(0.01, resource.label.width)), 0.65, 1]}
      onClick={choose} />
  </group>;
}

export function SpatialDiagram({ graph, theme, enabled, scale, selectedKey, onSelectedKey, onProjection, onController }: {
  graph: SpatialDiagramGraph;
  theme: ThemeName;
  enabled: boolean;
  scale: number;
  selectedKey?: string;
  onSelectedKey(key?: string): void;
  onProjection(): void;
  onController(controller?: SpatialDiagramController): void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [focused, setFocused] = useState(false);
  const pages = useMemo(() => spatialDiagramPages(graph, collapsed), [graph, collapsed]);
  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const placements = useMemo(() => layoutSpatialNodes(graph, page), [graph, page]);
  const placementById = useMemo(() => new Map(placements.map((placement) => [placement.id, placement])), [placements]);
  const selection = useMemo<Selection | undefined>(() => {
    const node = graph.nodes.find((item) => item.key === selectedKey);
    if (node) return { key: node.key, kind: 'node', id: node.id };
    const edge = graph.edges.find((item) => item.key === selectedKey);
    if (edge) return { key: edge.key, kind: 'edge', id: edge.id };
    const group = graph.groups.find((item) => item.key === selectedKey);
    return group ? { key: group.key, kind: 'group', id: group.id } : undefined;
  }, [graph, selectedKey]);
  const selectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selection?.kind === 'node') {
      ids.add(selection.id);
      for (const edge of graph.edges) {
        if (edge.start === selection.id) ids.add(edge.end);
        if (edge.end === selection.id) ids.add(edge.start);
      }
    } else if (selection?.kind === 'edge') {
      const edge = graph.edges.find((item) => item.id === selection.id);
      if (edge) { ids.add(edge.start); ids.add(edge.end); }
    } else if (selection?.kind === 'group') {
      graph.groups.find((item) => item.id === selection.id)?.nodeIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [graph, selection]);
  const selectionLabel = selection?.kind === 'node' ? graph.nodes.find((node) => node.id === selection.id)?.label
    : selection?.kind === 'edge' ? graph.edges.find((edge) => edge.id === selection.id)?.label || `${graph.edges.find((edge) => edge.id === selection.id)?.start} → ${graph.edges.find((edge) => edge.id === selection.id)?.end}`
      : selection?.kind === 'group' ? graph.groups.find((group) => group.id === selection.id)?.label : undefined;
  const hiddenNodes = graph.nodes.length - page.nodeIds.length;
  const hiddenEdges = graph.edges.length - page.edgeIds.length;
  const status = useTextureResource((ledger) => createWorkspaceTextResource(
    selectionLabel ? `${selection?.kind}: ${selectionLabel}` : `Spatial flowchart · ${graph.nodes.length} nodes · ${graph.edges.length} edges`,
    selectionLabel
      ? `${selectedNodeIds.size} connected node${selectedNodeIds.size === 1 ? '' : 's'} · stable only in this artifact`
      : `Detail ${Math.min(pageIndex, pages.length - 1) + 1}/${pages.length} · ${hiddenNodes} nodes and ${hiddenEdges} edges on other/collapsed detail`,
    theme, ledger, true, true,
  ), [selectionLabel, selection?.kind, selectedNodeIds.size, graph.nodes.length, graph.edges.length, pageIndex, pages.length, hiddenNodes, hiddenEdges, theme]);
  const actions: CanvasReviewActionName[] = ['projection', 'rotate-left', 'rotate-right', 'focus-selection', 'toggle-group', 'reset-spatial'];
  const icons = useTextureResource((ledger) => Object.fromEntries(actions.map((action) => [action,
    createWorkspaceButtonResource(CANVAS_REVIEW_ACTIONS[action], theme, ledger),
  ])), [theme]);
  const perform = useCallback((action: CanvasReviewActionName) => {
    if (!enabled) return;
    if (action === 'projection') onProjection();
    else if (action === 'rotate-left') setRotation((value) => value - Math.PI / 12);
    else if (action === 'rotate-right') setRotation((value) => value + Math.PI / 12);
    else if (action === 'focus-selection' && selection) setFocused((value) => !value);
    else if (action === 'toggle-group' && selection?.kind === 'group') setCollapsed((value) => {
      const next = new Set(value);
      if (next.has(selection.id)) next.delete(selection.id); else next.add(selection.id);
      return next;
    });
    else if (action === 'previous-detail') setPageIndex((value) => Math.max(0, value - 1));
    else if (action === 'next-detail') setPageIndex((value) => Math.min(pages.length - 1, value + 1));
    else if (action === 'reset-spatial') { setCollapsed(new Set()); setPageIndex(0); setRotation(0); setFocused(false); onSelectedKey(undefined); }
  }, [enabled, onProjection, onSelectedKey, pages.length, selection]);
  useEffect(() => { setPageIndex((value) => Math.min(value, pages.length - 1)); }, [pages.length]);
  useEffect(() => { onController({ perform }); return () => onController(undefined); }, [onController, perform]);
  const select = (value: Selection) => { if (enabled) { onSelectedKey(value.key); setFocused(false); } };
  const focusPosition = useMemo(() => {
    if (!focused || !selection) return;
    if (selection.kind === 'node') return placementById.get(selection.id)?.position;
    if (selection.kind === 'edge') {
      const edge = graph.edges.find((item) => item.id === selection.id);
      const start = edge && placementById.get(edge.start); const end = edge && placementById.get(edge.end);
      return start && end ? [
        (start.position[0] + end.position[0]) / 2,
        (start.position[1] + end.position[1]) / 2,
        (start.position[2] + end.position[2]) / 2,
      ] as [number, number, number] : undefined;
    }
    const memberPlacements = graph.groups.find((group) => group.id === selection.id)?.nodeIds
      .flatMap((id) => placementById.get(id) || []);
    return memberPlacements?.length ? [
      memberPlacements.reduce((sum, item) => sum + item.position[0], 0) / memberPlacements.length,
      memberPlacements.reduce((sum, item) => sum + item.position[1], 0) / memberPlacements.length,
      memberPlacements.reduce((sum, item) => sum + item.position[2], 0) / memberPlacements.length,
    ] as [number, number, number] : undefined;
  }, [focused, graph.edges, graph.groups, placementById, selection]);
  const visibleGroups = graph.groups.filter((group) => collapsed.has(group.id) || group.nodeIds.some((id) => page.nodeIds.includes(id)));
  const buttonPositions: Record<string, [number, number, number]> = {
    projection: [-0.51, 0.58, 0], 'rotate-left': [-0.24, 0.58, 0], 'rotate-right': [0.02, 0.58, 0],
    'focus-selection': [0.30, 0.58, 0], 'toggle-group': [0.52, 0.58, 0], 'reset-spatial': [0.49, 0.38, 0],
  };
  return <group name="Spatial diagram" userData={{ artifactId: graph.artifactId, selectedKey, rotation, scale,
    page: Math.min(pageIndex, pages.length - 1) + 1, pages: pages.length, visibleNodes: page.nodeIds.length,
    visibleEdges: page.edgeIds.length, hiddenNodes, hiddenEdges, collapsedGroups: [...collapsed], focused }}>
    <group name="Spatial diagram geometry" position={[focusPosition ? -focusPosition[0] : 0, focusPosition ? -focusPosition[1] - 0.04 : -0.05, 0.01]}
      rotation-y={rotation} scale={scale}>
      {visibleGroups.map((group) => <SpatialGroupObject key={group.key} graph={graph} groupId={group.id} placements={placements}
        collapsed={collapsed.has(group.id)} theme={theme} selected={selection?.key === group.key} onSelect={select} />)}
      {page.edgeIds.map((id) => {
        const edge = graph.edges.find((candidate) => candidate.id === id)!;
        const start = placementById.get(edge.start); const end = placementById.get(edge.end);
        return start && end ? <SpatialEdgeObject key={edge.key} edge={edge} start={start} end={end} theme={theme}
          selected={selection?.key === edge.key} neighbor={selectedNodeIds.has(edge.start) && selectedNodeIds.has(edge.end)} onSelect={select} /> : null;
      })}
      {page.nodeIds.map((id) => {
        const node = graph.nodes.find((candidate) => candidate.id === id)!;
        return <SpatialNode key={node.key} node={node} placement={placementById.get(id)!} theme={theme}
          selected={selection?.key === node.key} neighbor={selectedNodeIds.has(node.id)} onSelect={select} />;
      })}
    </group>
    {status && <mesh name="Spatial diagram status" geometry={status.geometry} material={status.material} position={[0, -0.49, 0.02]}
      pointerEvents="none" raycast={() => undefined} />}
    <ControlGroupSurface name="Spatial diagram controls" width={1.2} position={[0, 0.58, 0]} theme={theme} />
    {actions.map((action) => <WorldButton key={action} action={`canvas:${action}`} label={CANVAS_REVIEW_ACTIONS[action]}
      resource={icons?.[action]} iconTheme={theme} position={buttonPositions[action]}
      selected={action === 'focus-selection' && focused || action === 'toggle-group' && selection?.kind === 'group' && collapsed.has(selection.id)}
      disabled={!enabled || action === 'focus-selection' && !selection || action === 'toggle-group' && selection?.kind !== 'group'}
      onAction={() => perform(action)} />)}
    {pages.length > 1 && <WorkspacePager label={`Detail ${Math.min(pageIndex, pages.length - 1) + 1} of ${pages.length}`}
      previousAction="canvas:previous-detail" nextAction="canvas:next-detail" previousLabel="Previous detail" nextLabel="Next detail"
      position={[-0.17, 0.38, 0]} theme={theme} previousDisabled={pageIndex === 0} nextDisabled={pageIndex >= pages.length - 1}
      onAction={(action) => perform(action.slice('canvas:'.length) as CanvasReviewActionName)} />}
  </group>;
}
