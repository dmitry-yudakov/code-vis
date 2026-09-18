import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, type ThreeElements, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import type { ImmersiveTexturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { ImmersiveSemanticAction } from '@/features/diagram/spatial/immersiveTypes';
import {
  PANEL_COMMAND_LABELS, PANEL_HEIGHT, PANEL_SIZES, PANEL_TITLES, PANEL_WIDTH, panelTransform,
  type PanelCommand, type PanelEditing, type PanelPlacement, type WorkspacePanelId, type WorkspacePanelLayout,
} from './workspaceLayout';
import { createWorkspaceButtonResource, createWorkspaceLabelResource, createWorkspaceTextResource, type PanelControlResources } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { usePanelDrag } from './usePanelDrag';
import { createWorkspaceIconResource, createWorkspaceTooltipResource } from './workspaceIcons';
import {
  IMMERSIVE_CONTROL_BAR_GAP, IMMERSIVE_CONTROL_HEIGHT, IMMERSIVE_FOCUS_GAP, IMMERSIVE_FOCUS_WIDTH,
  IMMERSIVE_LAYERS, IMMERSIVE_PANEL_RADIUS, immersiveTheme,
} from './immersiveTheme';

export function roundedGeometry(width: number, height: number, radius: number): THREE.ShapeGeometry {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ShapeGeometry(shape);
}

export type WorldButtonVariant = 'secondary' | 'primary' | 'destructive' | 'bare';

export function ControlGroupSurface({ name, width, position, theme }: {
  name: string;
  width: number;
  position: [number, number, number];
  theme: ThemeName;
}) {
  const resource = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(roundedGeometry(width, IMMERSIVE_CONTROL_HEIGHT + 0.025, (IMMERSIVE_CONTROL_HEIGHT + 0.025) / 2)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({
      color: immersiveTheme[theme].raised, depthWrite: false, toneMapped: false,
    })),
  }), [width, theme]);
  return resource && <mesh name={name} geometry={resource.geometry} material={resource.material}
    position={position} renderOrder={10} pointerEvents="none" raycast={() => undefined} />;
}

export function WorldButton({ action, label, resource, tooltip, iconTheme = 'dark', position, disabled = false, selected = false,
  variant = 'secondary', hitArea, pointerHandlers, onAction }: {
  action: ImmersiveSemanticAction;
  label: string;
  resource?: ImmersiveTexturePanel;
  tooltip?: ImmersiveTexturePanel;
  iconTheme?: ThemeName;
  position: [number, number, number];
  disabled?: boolean;
  selected?: boolean;
  variant?: WorldButtonVariant;
  hitArea?: { width: number; height: number; offset: [number, number, number] };
  pointerHandlers?: Pick<ThreeElements['mesh'], 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'>;
  onAction(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [tooltipReady, setTooltipReady] = useState(false);
  const tooltipTarget = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tooltipMesh = useRef<THREE.Mesh>(null);
  const autoTooltip = resource?.presentation === 'icon-mask';
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (pressed || disabled || (!tooltip && !autoTooltip)) {
      tooltipTarget.current = false;
      setTooltipReady(false);
      return;
    }
    if (!hovered) {
      hideTimer.current = setTimeout(() => { tooltipTarget.current = false; }, 500);
      return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    }
    const timer = setTimeout(() => { tooltipTarget.current = true; setTooltipReady(true); }, 450);
    return () => clearTimeout(timer);
  }, [autoTooltip, disabled, hovered, pressed, label, tooltip]);
  const hoverLabel = useTextureResource((ledger) => tooltipReady && !tooltip && autoTooltip
    ? createWorkspaceTooltipResource(label, iconTheme, ledger) : undefined, [tooltipReady, iconTheme, label, tooltip, autoTooltip]);
  const visibleTooltip = tooltip || hoverLabel;
  const tooltipMaterial = useTextureResource((ledger) => {
    if (!visibleTooltip) return undefined;
    const clone = ledger.trackMaterial(visibleTooltip.material.clone());
    clone.opacity = 0; clone.transparent = true; clone.depthWrite = false; clone.depthTest = false;
    return clone;
  }, [visibleTooltip]);
  useFrame((_state, delta) => {
    if (!tooltipMaterial || !tooltipMesh.current) return;
    tooltipMaterial.opacity = THREE.MathUtils.clamp(tooltipMaterial.opacity + (tooltipTarget.current ? 1 : -1) * delta / 0.15, 0, 1);
    tooltipMesh.current.visible = tooltipMaterial.opacity > 0;
    tooltipMesh.current.userData.tooltipOpacity = tooltipMaterial.opacity;
    if (!tooltipTarget.current && tooltipMaterial.opacity === 0 && tooltipReady) setTooltipReady(false);
  });
  const foreground = useTextureResource((ledger) => resource && ledger.trackMaterial(resource.material.clone()), [resource]);
  const button = useTextureResource((ledger) => {
    if (!resource || variant === 'bare') return undefined;
    const circle = Math.abs(resource.width - resource.height) < 0.001;
    return {
      geometry: ledger.trackGeometry(circle
        ? new THREE.CircleGeometry(Math.max(IMMERSIVE_CONTROL_HEIGHT, resource.height) / 2, 48)
        : roundedGeometry(Math.max(IMMERSIVE_CONTROL_HEIGHT, resource.width), IMMERSIVE_CONTROL_HEIGHT, IMMERSIVE_CONTROL_HEIGHT / 2)),
      material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false })),
    };
  }, [resource, variant]);
  const hitTarget = useTextureResource((ledger) => hitArea ? {
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(hitArea.width, hitArea.height)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
    })),
  } : undefined, [hitArea?.width, hitArea?.height]);
  useEffect(() => {
    if (!foreground) return;
    const colors = immersiveTheme[iconTheme];
    foreground.transparent = true;
    foreground.depthWrite = false;
    foreground.opacity = disabled ? 0.4 : 1;
    foreground.color.set(resource?.presentation === 'precolored' ? '#FFFFFF'
      : selected || variant === 'primary' ? colors.selectedInk
        : variant === 'destructive' ? colors.negative : colors.text);
  }, [disabled, selected, variant, iconTheme, foreground, resource?.presentation]);
  useEffect(() => {
    if (!button) return;
    const colors = immersiveTheme[iconTheme];
    button.material.color.set(selected || variant === 'primary' ? colors.selected
      : pressed ? colors.pressed : hovered ? colors.hover : colors.control);
  }, [button, hovered, iconTheme, pressed, selected, variant]);
  if (!resource || !foreground) return null;
  const finish = () => setPressed(false);
  const invoke = (handler: unknown, event: ThreeEvent<PointerEvent>) => {
    if (typeof handler === 'function') (handler as (value: ThreeEvent<PointerEvent>) => void)(event);
  };
  const down = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!disabled) {
      tooltipTarget.current = false;
      setTooltipReady(false);
      setPressed(true);
    }
    invoke(pointerHandlers?.onPointerDown, event);
  };
  const bare = variant === 'bare';
  const layer = bare ? 0 : hovered && !disabled && !pressed ? IMMERSIVE_LAYERS.hover : IMMERSIVE_LAYERS.controls;
  const foregroundOrder = bare ? 4 : 21;
  return <group position={position}>
    <group position-z={layer}>
      {button && <mesh name={`${label} background`} geometry={button.geometry} material={button.material} renderOrder={20}
        position-z={-0.0005} pointerEvents="none" raycast={() => undefined} />}
      {hitTarget && <mesh name={`${label} display`} geometry={resource.geometry} material={foreground} renderOrder={foregroundOrder}
        pointerEvents="none" raycast={() => undefined} />}
      <mesh name={label} geometry={hitTarget?.geometry || resource.geometry} material={hitTarget?.material || foreground} renderOrder={foregroundOrder}
        position={hitArea?.offset}
        userData={{ immersiveAction: action, disabled, hovered, pressed, selected, variant }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); if (!disabled) setHovered(true); }}
        onPointerOut={() => { setHovered(false); finish(); }} onPointerDown={down}
        onPointerMove={(event) => invoke(pointerHandlers?.onPointerMove, event)}
        onPointerUp={(event) => { finish(); invoke(pointerHandlers?.onPointerUp, event); }}
        onPointerCancel={(event) => { finish(); invoke(pointerHandlers?.onPointerCancel, event); }}
        onLostPointerCapture={(event) => { finish(); invoke(pointerHandlers?.onLostPointerCapture, event); }}
        onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (!disabled) onAction(); }} />
    </group>
    {visibleTooltip && tooltipMaterial && <mesh ref={tooltipMesh} name={`${label} tooltip`} geometry={visibleTooltip.geometry} material={tooltipMaterial}
      position={[0, -resource.height / 2 - 0.06, IMMERSIVE_LAYERS.tooltip]} visible={false} renderOrder={1000}
      userData={{ immersiveTooltip: label }} pointerEvents="none" raycast={() => undefined} />}
  </group>;
}

export function WorkspacePager({ label, previousAction, nextAction, previousLabel, nextLabel, position, theme,
  previousDisabled = false, nextDisabled = false, onAction }: {
  label: string;
  previousAction: ImmersiveSemanticAction;
  nextAction: ImmersiveSemanticAction;
  previousLabel: string;
  nextLabel: string;
  position: [number, number, number];
  theme: ThemeName;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  onAction(action: ImmersiveSemanticAction): void;
}) {
  const resources = useTextureResource((ledger) => ({
    previous: createWorkspaceIconResource('pager:previous', theme, ledger),
    next: createWorkspaceIconResource('pager:next', theme, ledger),
    label: createWorkspaceLabelResource(label, theme, ledger),
  }), [label, theme]);
  const labelWidth = resources?.label.width || 0.2;
  const offset = labelWidth / 2 + IMMERSIVE_CONTROL_HEIGHT / 2 + 0.015;
  return <group name={`${label} pager`} position={position} userData={{ immersivePager: label }}>
    <WorldButton action={previousAction} label={previousLabel} resource={resources?.previous} iconTheme={theme}
      position={[-offset, 0, 0]} disabled={previousDisabled} onAction={() => onAction(previousAction)} />
    {resources && <mesh name={`${label} pager label`} geometry={resources.label.geometry} material={resources.label.material}
      position-z={IMMERSIVE_LAYERS.controls} renderOrder={21} pointerEvents="none" raycast={() => undefined} />}
    <WorldButton action={nextAction} label={nextLabel} resource={resources?.next} iconTheme={theme}
      position={[offset, 0, 0]} disabled={nextDisabled} onAction={() => onAction(nextAction)} />
  </group>;
}

export function WorkspacePanel({ id, heading, detail, headerBack = false, layout, focused, editing, theme, controls, perform, onPlacement, children }: {
  id: WorkspacePanelId;
  heading?: string;
  detail?: string;
  headerBack?: boolean;
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
  const surface = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(roundedGeometry(PANEL_WIDTH, PANEL_HEIGHT, IMMERSIVE_PANEL_RADIUS)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: immersiveTheme[theme].surface, toneMapped: false })),
    focusGeometry: ledger.trackGeometry(roundedGeometry(
      PANEL_WIDTH + 2 * (IMMERSIVE_FOCUS_GAP + IMMERSIVE_FOCUS_WIDTH),
      PANEL_HEIGHT + 2 * (IMMERSIVE_FOCUS_GAP + IMMERSIVE_FOCUS_WIDTH),
      IMMERSIVE_PANEL_RADIUS + IMMERSIVE_FOCUS_GAP + IMMERSIVE_FOCUS_WIDTH,
    )),
    focusMaterial: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: immersiveTheme[theme].focus, toneMapped: false, depthWrite: false })),
    barGeometry: ledger.trackGeometry(roundedGeometry(0.94, IMMERSIVE_CONTROL_HEIGHT + 0.04, (IMMERSIVE_CONTROL_HEIGHT + 0.04) / 2)),
    barMaterial: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: immersiveTheme[theme].raised, toneMapped: false, depthWrite: false })),
  }), [theme]);
  const title = useTextureResource((ledger) => createWorkspaceTextResource(heading || PANEL_TITLES[id],
    mode === 'drag' ? 'Release to place' : mode === 'resize' ? `Size: ${PANEL_COMMAND_LABELS[layout.size]}` : detail || '',
    theme, ledger, id !== 'canvas', headerBack), [id, heading, detail, headerBack, mode, layout.size, theme]);
  const panelName = useTextureResource((ledger) => createWorkspaceButtonResource(PANEL_TITLES[id], theme, ledger), [id, theme]);
  const commands: PanelCommand[] = [...Object.keys(PANEL_SIZES) as Array<keyof typeof PANEL_SIZES>, 'done'];
  const menuResources = useTextureResource((ledger) => Object.fromEntries(commands.map((command) => [command,
    createWorkspaceButtonResource(command === layout.size ? `✓ ${PANEL_COMMAND_LABELS[command]}` : PANEL_COMMAND_LABELS[command], theme, ledger),
  ])) as Record<PanelCommand, ImmersiveTexturePanel>, [layout.size, theme]);
  const button = (command: PanelCommand, position: [number, number, number]) => <WorldButton key={command}
    action={`panel:${id}:${command}`} label={`${PANEL_COMMAND_LABELS[command]} ${PANEL_TITLES[id]}`}
    resource={menuResources?.[command]} position={position} iconTheme={theme} disabled={dragging} selected={command === layout.size}
    onAction={() => perform(`panel:${id}:${command}`)} />;
  const barY = -PANEL_HEIGHT / 2 - IMMERSIVE_CONTROL_BAR_GAP - (IMMERSIVE_CONTROL_HEIGHT + 0.04) / 2;
  return <group ref={group} name={`${PANEL_TITLES[id]} panel`} position={transform.position} rotation-y={transform.rotationY}
    scale={PANEL_SIZES[layout.size]} userData={{ workspacePanel: id, focused: highlighted, editing: mode, heading: heading || PANEL_TITLES[id], detail }}>
    {surface && <>
      {highlighted && <mesh name={`${PANEL_TITLES[id]} focus outline`} geometry={surface.focusGeometry} material={surface.focusMaterial} position-z={-0.001} renderOrder={0} />}
      <mesh name={`${PANEL_TITLES[id]} surface`} geometry={surface.geometry} material={surface.material} renderOrder={1}
        userData={{ immersivePanelSurface: id, radius: IMMERSIVE_PANEL_RADIUS }}
        onClick={(event) => event.stopPropagation()} />
      <mesh name={`${PANEL_TITLES[id]} control bar background`} geometry={surface.barGeometry} material={surface.barMaterial}
        position={[0, barY, IMMERSIVE_LAYERS.content]} renderOrder={10} />
    </>}
    <WorldButton action={`panel:${id}:focus`} label={`Focus ${PANEL_TITLES[id]}`} resource={title}
      position={[0, 0.79, IMMERSIVE_LAYERS.content]} iconTheme={theme} variant="bare" hitArea={title?.titleHit} disabled={dragging}
      onAction={() => perform(`panel:${id}:focus`)} />
    <group name={`${PANEL_TITLES[id]} toolbar`} position={[0, barY, IMMERSIVE_LAYERS.content]}>
      <WorldButton action={`panel:${id}:drag`} label={`Drag ${PANEL_TITLES[id]}`} resource={controls?.buttons.drag}
        position={[-0.37, 0, 0]} iconTheme={theme} selected={mode === 'drag'} disabled={dragging && mode !== 'drag'}
        pointerHandlers={handlers} onAction={() => undefined} />
      {panelName && <mesh name={`${PANEL_TITLES[id]} control bar title`} geometry={panelName.geometry} material={panelName.material}
        position={[-0.11, 0, IMMERSIVE_LAYERS.controls]} renderOrder={21} pointerEvents="none" raycast={() => undefined} />}
      <WorldButton action={`panel:${id}:resize`} label={`Size ${PANEL_TITLES[id]}`} resource={controls?.buttons.resize}
        position={[0.24, 0, 0]} iconTheme={theme} selected={mode === 'resize'} disabled={dragging}
        onAction={() => perform(`panel:${id}:resize`)} />
      <WorldButton action={`panel:${id}:close`} label={`Close ${PANEL_TITLES[id]}`} resource={controls?.buttons.close}
        position={[0.39, 0, 0]} iconTheme={theme} variant="destructive" disabled={dragging}
        onAction={() => perform(`panel:${id}:close`)} />
    </group>
    {mode === 'resize' && commands.map((command, index) => button(command,
      [index % 2 === 0 ? -0.3 : 0.3, 0.28 - Math.floor(index / 2) * 0.24, IMMERSIVE_LAYERS.content]))}
    {(mode !== 'resize' || id === 'conversation') && <group name={`${PANEL_TITLES[id]} content`}
      position-z={IMMERSIVE_LAYERS.content}
      visible={mode !== 'resize'} pointerEvents={dragging || mode === 'resize' ? 'none' : 'auto'}>{children}</group>}
  </group>;
}
