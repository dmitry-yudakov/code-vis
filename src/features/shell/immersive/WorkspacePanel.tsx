import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreeElements, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { palette, type ThemeName } from '@/shared/design/tokens';
import type { ImmersiveTexturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { ImmersiveSemanticAction } from '@/features/diagram/spatial/immersiveTypes';
import {
  PANEL_COMMAND_LABELS, PANEL_HEIGHT, PANEL_SIZES, PANEL_TITLES, PANEL_WIDTH, panelTransform,
  type PanelCommand, type PanelEditing, type PanelPlacement, type WorkspacePanelId, type WorkspacePanelLayout,
} from './workspaceLayout';
import { createWorkspaceTextResource, type PanelControlResources } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { usePanelDrag } from './usePanelDrag';

export function WorldButton({ action, label, resource, tooltip, position, disabled = false, selected = false, pointerHandlers, onAction }: {
  action: ImmersiveSemanticAction;
  label: string;
  resource?: ImmersiveTexturePanel;
  tooltip?: ImmersiveTexturePanel;
  position: [number, number, number];
  disabled?: boolean;
  selected?: boolean;
  pointerHandlers?: Pick<ThreeElements['mesh'], 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'>;
  onAction(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const material = useTextureResource((ledger) => resource && ledger.trackMaterial(resource.material.clone()), [resource]);
  useEffect(() => {
    if (material) { material.opacity = disabled ? 0.4 : 1; material.transparent = true; material.color.set(selected ? '#a9c2ff' : '#ffffff'); }
  }, [disabled, selected, material]);
  if (!resource || !material) return null;
  return <group position={position}>
    <mesh name={label} geometry={resource.geometry} material={material} renderOrder={tooltip ? 1 : 0}
      scale={hovered && !disabled ? 1.03 : 1} userData={{ immersiveAction: action, disabled }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (!disabled) onAction(); }}
      {...pointerHandlers} />
    {tooltip && <mesh name={`${label} tooltip`} geometry={tooltip.geometry} material={tooltip.material}
      position={[0, -0.24, 0.03]} visible={hovered && !disabled}
      userData={{ immersiveTooltip: label }} pointerEvents="none" raycast={() => undefined} />}
  </group>;
}

export function WorkspacePanel({ id, layout, focused, editing, theme, controls, perform, onPlacement, children }: {
  id: WorkspacePanelId;
  layout: WorkspacePanelLayout;
  focused: boolean;
  editing?: PanelEditing;
  theme: ThemeName;
  controls?: PanelControlResources;
  perform(action: ImmersiveSemanticAction): void;
  onPlacement(id: WorkspacePanelId, placement: PanelPlacement): void;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const mode = editing?.id === id ? editing.mode : undefined;
  const dragging = editing?.mode === 'drag';
  const { preview, handlers } = usePanelDrag(group, mode === 'drag', dragging,
    () => perform(`panel:${id}:drag`),
    (placement) => placement ? onPlacement(id, placement) : perform(`panel:${id}:done`));
  const transform = panelTransform({ ...layout, ...preview });
  const highlighted = focused || mode === 'drag';
  const frame = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(PANEL_WIDTH + 0.04, PANEL_HEIGHT + 0.04)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: highlighted ? palette[theme].plot : palette[theme].lineStrong })),
    inset: ledger.trackGeometry(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT)),
    background: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: palette[theme].raised })),
  }), [theme, highlighted]);
  const title = useTextureResource((ledger) => createWorkspaceTextResource(PANEL_TITLES[id],
    mode === 'drag' ? 'Release to place'
      : mode === 'resize' ? `Size: ${PANEL_COMMAND_LABELS[layout.size]}`
        : focused ? 'Focused' : 'Select to focus', theme, ledger), [id, mode, layout.size, focused, theme]);
  const commands: PanelCommand[] = [...Object.keys(PANEL_SIZES) as Array<keyof typeof PANEL_SIZES>, 'done'];
  const button = (command: PanelCommand, position: [number, number, number]) => <WorldButton key={command}
    action={`panel:${id}:${command}`} label={`${PANEL_COMMAND_LABELS[command]} ${PANEL_TITLES[id]}`}
    resource={controls?.buttons[command]} position={position} disabled={dragging} selected={command === layout.size}
    onAction={() => perform(`panel:${id}:${command}`)} />;
  return <group ref={group} name={`${PANEL_TITLES[id]} panel`} position={transform.position} rotation-y={transform.rotationY}
    scale={PANEL_SIZES[layout.size]} userData={{ workspacePanel: id, focused: highlighted, editing: mode }}>
    {frame && <>
      <mesh geometry={frame.geometry} material={frame.material} position-z={-0.025} />
      <mesh geometry={frame.inset} material={frame.background} position-z={-0.02}
        onClick={(event) => event.stopPropagation()} />
    </>}
    <WorldButton action={`panel:${id}:focus`} label={`Focus ${PANEL_TITLES[id]}`} resource={title}
      position={[0, 0.78, 0.01]} disabled={dragging} onAction={() => perform(`panel:${id}:focus`)} />
    <group name={`${PANEL_TITLES[id]} toolbar`} position={[0, -PANEL_HEIGHT / 2 - 0.18, 0.02]}>
      {controls && <mesh geometry={controls.toolbar.geometry} material={controls.toolbar.material} position-z={-0.01} />}
      <WorldButton action={`panel:${id}:drag`} label={`Drag ${PANEL_TITLES[id]}`} resource={controls?.buttons.drag}
        tooltip={controls?.tooltips.drag} position={[-0.19, 0, 0]} selected={mode === 'drag'} disabled={dragging && mode !== 'drag'}
        pointerHandlers={handlers} onAction={() => undefined} />
      <WorldButton action={`panel:${id}:resize`} label={`Size ${PANEL_TITLES[id]}`} resource={controls?.buttons.resize}
        tooltip={controls?.tooltips.resize} position={[0, 0, 0]} selected={mode === 'resize'} disabled={dragging}
        onAction={() => perform(`panel:${id}:resize`)} />
      <WorldButton action={`panel:${id}:close`} label={`Close ${PANEL_TITLES[id]}`} resource={controls?.buttons.close}
        tooltip={controls?.tooltips.close} position={[0.19, 0, 0]} disabled={dragging}
        onAction={() => perform(`panel:${id}:close`)} />
    </group>
    {mode === 'resize' ? commands.map((command, index) => button(command, [index % 2 === 0 ? -0.3 : 0.3, 0.28 - Math.floor(index / 2) * 0.24, 0.03]))
      : <group name={`${PANEL_TITLES[id]} content`} pointerEvents={dragging ? 'none' : 'auto'}>{children}</group>}
  </group>;
}
