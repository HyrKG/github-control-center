import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  changeTypeStatus,
  DEFAULT_IMAGE_VIEWER_STRINGS,
  formatImageBytes,
  IMAGE_VIEWER_CONTROLLER_SCRIPT,
  IMAGE_VIEWER_SHARED_CSS,
  safeJsonForScript,
} from "./imageViewer";

interface IControllerState {
  scale: number;
  tx: number;
  ty: number;
  fitScale: number;
  isFitted: boolean;
  hasFitted: boolean;
  dragging: boolean;
  justDragged: boolean;
}

interface IControllerExports {
  computeFitScale: (vw: number, vh: number, nw: number, nh: number) => number;
  formatImageBytes: (bytes: number | null) => string;
  createImageTransformController: (opts: {
    getViewportRect: () => { left: number; top: number; width: number; height: number } | null;
    getRefSize: () => { w: number; h: number } | null;
    onUpdate: (state: IControllerState) => void;
  }) => {
    state: IControllerState;
    fit: () => boolean;
    refitIfFitted: () => void;
    setZoom: (nextScale: number, clientX?: number, clientY?: number) => void;
    stepZoom: (dir: number, clientX?: number, clientY?: number) => void;
    toggleFitOneToOne: (clientX?: number, clientY?: number) => void;
    consumeJustDragged: () => boolean;
    bindViewport: (el: unknown) => void;
  };
}

function loadControllerScript(): IControllerExports {
  const sandbox = {
    setTimeout,
    exports: {} as Partial<IControllerExports>,
  };
  runInNewContext(
    `${IMAGE_VIEWER_CONTROLLER_SCRIPT}
    exports.computeFitScale = computeFitScale;
    exports.formatImageBytes = formatImageBytes;
    exports.createImageTransformController = createImageTransformController;`,
    sandbox,
  );
  return sandbox.exports as IControllerExports;
}

describe("imageViewer helpers", () => {
  it("escapes script-breaking characters in safeJsonForScript", () => {
    const raw = { path: 'a</script><img onerror="alert(1)">.png', sep: "\u2028\u2029" };
    const encoded = safeJsonForScript(raw);

    expect(encoded).not.toContain("</script>");
    expect(encoded).toContain("\\u003c/script>");
    expect(encoded).toContain("\\u2028\\u2029");
    expect(JSON.parse(encoded)).toEqual(raw);
  });

  it("formats positive and negative byte counts consistently", () => {
    expect(formatImageBytes(0)).toBe("0 B");
    expect(formatImageBytes(512)).toBe("512 B");
    expect(formatImageBytes(2048)).toBe("2.0 KB");
    expect(formatImageBytes(15360)).toBe("15 KB");
    expect(formatImageBytes(-5120)).toBe("-5.0 KB");
    expect(formatImageBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });

  it("maps every FileChangeType to a pill class and label", () => {
    expect(changeTypeStatus("ADDED")).toEqual({ css: "added", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusAdded });
    expect(changeTypeStatus("MODIFIED")).toEqual({ css: "modified", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusModified });
    expect(changeTypeStatus("DELETED")).toEqual({ css: "deleted", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusDeleted });
    expect(changeTypeStatus("RENAMED")).toEqual({ css: "renamed", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusRenamed });
    expect(changeTypeStatus("COPIED")).toEqual({ css: "copied", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusCopied });
    expect(changeTypeStatus("CHANGED")).toEqual({ css: "changed", label: DEFAULT_IMAGE_VIEWER_STRINGS.statusChanged });
  });

  it("adapts canvas theme tokens for VS Code light themes without overriding --vscode-* variables", () => {
    expect(IMAGE_VIEWER_SHARED_CSS).toContain("body.vscode-light");
    expect(IMAGE_VIEWER_SHARED_CSS).toContain("body.vscode-high-contrast-light");
    expect(IMAGE_VIEWER_SHARED_CSS).toContain("--ghcc-canvas-bg");
    expect(IMAGE_VIEWER_SHARED_CSS).toContain("--ghcc-checker-a");
    expect(IMAGE_VIEWER_SHARED_CSS).not.toMatch(/--vscode-[a-zA-Z0-9-]+\s*:/);
  });

  it("uses true nearest-neighbor pixelated rendering without crisp-edges override or will-change", () => {
    expect(IMAGE_VIEWER_SHARED_CSS).toContain("image-rendering: pixelated;");
    expect(IMAGE_VIEWER_SHARED_CSS).not.toContain("crisp-edges");
    expect(IMAGE_VIEWER_SHARED_CSS).not.toContain("will-change");
    expect(DEFAULT_IMAGE_VIEWER_STRINGS.pixelCrisp).toBe("Nearest-neighbor (P)");
  });
});

describe("imageViewer transform controller script", () => {
  it("computes fit scale for normal images and integer upscale for <=64px pixel icons", () => {
    const { computeFitScale } = loadControllerScript();

    expect(computeFitScale(800, 600, 1600, 900)).toBeCloseTo((800 - 32) / 1600, 5);
    expect(computeFitScale(800, 600, 400, 300)).toBe(1);

    const tinyScale = computeFitScale(800, 600, 16, 16);
    expect(Number.isInteger(tinyScale)).toBe(true);
    expect(tinyScale).toBeGreaterThanOrEqual(4);
    expect(tinyScale).toBeLessThanOrEqual(12);
  });

  it("clamps zoom to [0.1, 16], anchors around cursor, and preserves manual zoom on refitIfFitted", () => {
    const { createImageTransformController } = loadControllerScript();
    const onUpdate = vi.fn();
    let viewport = { left: 0, top: 0, width: 800, height: 600 };
    const ctrl = createImageTransformController({
      getViewportRect: () => viewport,
      getRefSize: () => ({ w: 1600, h: 1200 }),
      onUpdate,
    });

    ctrl.fit();
    expect(ctrl.state.isFitted).toBe(true);
    expect(ctrl.state.scale).toBeCloseTo((600 - 32) / 1200, 5);

    // Resize while fitted recomputes fit scale
    viewport = { left: 0, top: 0, width: 400, height: 300 };
    ctrl.refitIfFitted();
    expect(ctrl.state.scale).toBeCloseTo((300 - 32) / 1200, 5);

    // Manual zoom marks isFitted = false and clamps bounds
    ctrl.setZoom(100, 300, 200);
    expect(ctrl.state.scale).toBe(16);
    expect(ctrl.state.isFitted).toBe(false);
    expect(ctrl.state.tx).not.toBe(0);

    // Resize after manual zoom preserves manual scale & pan
    const prevScale = ctrl.state.scale;
    const prevTx = ctrl.state.tx;
    viewport = { left: 0, top: 0, width: 1000, height: 800 };
    ctrl.refitIfFitted();
    expect(ctrl.state.scale).toBe(prevScale);
    expect(ctrl.state.tx).toBe(prevTx);

    ctrl.setZoom(0.01);
    expect(ctrl.state.scale).toBe(0.1);
  });

  it("ignores sub-threshold 1-3px pointer jitter without drifting tx/ty or breaking isFitted", () => {
    const { createImageTransformController } = loadControllerScript();
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    const el = {
      addEventListener: (event: string, fn: (e: Record<string, unknown>) => void) => listeners.set(event, fn),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      setPointerCapture: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    const onUpdate = vi.fn();
    const ctrl = createImageTransformController({
      getViewportRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      getRefSize: () => ({ w: 800, h: 600 }),
      onUpdate,
    });
    ctrl.fit();
    ctrl.bindViewport(el);
    onUpdate.mockClear();

    listeners.get("pointerdown")?.({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.get("pointermove")?.({ clientX: 102, clientY: 101 });
    listeners.get("pointermove")?.({ clientX: 103, clientY: 100 });
    listeners.get("pointerup")?.({});

    expect(ctrl.state.tx).toBe(0);
    expect(ctrl.state.ty).toBe(0);
    expect(ctrl.state.isFitted).toBe(true);
    expect(ctrl.consumeJustDragged()).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();

    // Once movement reaches the 4px threshold, pan applies from startX/startY and leaves fitted state
    listeners.get("pointerdown")?.({ button: 0, clientX: 100, clientY: 100, pointerId: 2 });
    listeners.get("pointermove")?.({ clientX: 102, clientY: 101 });
    listeners.get("pointermove")?.({ clientX: 110, clientY: 106 });
    listeners.get("pointerup")?.({});

    expect(ctrl.state.tx).toBe(10);
    expect(ctrl.state.ty).toBe(6);
    expect(ctrl.state.isFitted).toBe(false);
    expect(ctrl.consumeJustDragged()).toBe(true);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("sets justDragged only when pointer moves past the drag threshold", () => {
    const { createImageTransformController } = loadControllerScript();
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    const el = {
      addEventListener: (event: string, fn: (e: Record<string, unknown>) => void) => listeners.set(event, fn),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      setPointerCapture: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    const ctrl = createImageTransformController({
      getViewportRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      getRefSize: () => ({ w: 1200, h: 900 }),
      onUpdate: vi.fn(),
    });
    ctrl.setZoom(1);
    ctrl.bindViewport(el);

    // Short click (<4px) does not mark justDragged
    listeners.get("pointerdown")?.({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.get("pointermove")?.({ clientX: 101, clientY: 101 });
    listeners.get("pointerup")?.({});
    expect(ctrl.consumeJustDragged()).toBe(false);

    // Real drag (>=4px) marks justDragged once
    listeners.get("pointerdown")?.({ button: 0, clientX: 100, clientY: 100, pointerId: 2 });
    listeners.get("pointermove")?.({ clientX: 120, clientY: 115 });
    listeners.get("pointerup")?.({});
    expect(ctrl.consumeJustDragged()).toBe(true);
    expect(ctrl.consumeJustDragged()).toBe(false);
  });

  it("allows dragging in fitted state, ignores dblclick zoom, and zooms via wheel", () => {
    const { createImageTransformController } = loadControllerScript();
    const listeners = new Map<string, (e: Record<string, unknown>) => void>();
    const el = {
      addEventListener: (event: string, fn: (e: Record<string, unknown>) => void) => listeners.set(event, fn),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    const ctrl = createImageTransformController({
      getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getRefSize: () => ({ w: 400, h: 300 }),
      onUpdate: vi.fn(),
    });
    ctrl.fit();
    ctrl.bindViewport(el);

    // No dblclick handler is attached on the canvas viewport
    expect(listeners.has("dblclick")).toBe(false);
    const scaleBefore = ctrl.state.scale;

    // Image smaller than viewport (100% fitted) can still be dragged freely
    listeners.get("pointerdown")?.({ button: 0, clientX: 100, clientY: 100, pointerId: 3 });
    listeners.get("pointermove")?.({ clientX: 140, clientY: 125 });
    listeners.get("pointerup")?.({});
    expect(ctrl.state.tx).toBe(40);
    expect(ctrl.state.ty).toBe(25);
    expect(ctrl.state.scale).toBe(scaleBefore);

    // Wheel zooms around cursor
    const preventDefault = vi.fn();
    listeners.get("wheel")?.({ deltaY: -120, clientX: 450, clientY: 320, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(ctrl.state.scale).toBeGreaterThan(scaleBefore);
  });
});
