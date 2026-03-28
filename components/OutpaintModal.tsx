import React, { useState, useRef, useCallback, useEffect } from 'react';
import { editImageStream, type ClientImageRef, type GenerateImageItem } from '../services/apiService';
import type { ImageElement } from '../types';

// ─── Preset prompts ───────────────────────────────────────────────────────────
const PRESET_PROMPTS = [
    { label: '自然延伸', labelEn: 'Natural Extension', value: 'Seamlessly extend the image outward, maintaining consistent style, lighting, and content. Fill the expanded area naturally.' },
    { label: '无缝背景', labelEn: 'Seamless Background', value: 'Continue the background naturally, keeping the same atmosphere, perspective and lighting conditions.' },
    { label: '风景扩展', labelEn: 'Landscape', value: 'Expand the landscape naturally with consistent horizon line, sky, and scenery matching the original image style.' },
    { label: '室内扩展', labelEn: 'Interior', value: 'Extend the room interior naturally, maintaining the same decor style, lighting, and perspective.' },
    { label: '人像扩展', labelEn: 'Portrait', value: 'Extend the portrait scene naturally to reveal more of the environment, keeping lighting and style consistent.' },
];

// ─── Expand presets ───────────────────────────────────────────────────────────
type Expand = { top: number; right: number; bottom: number; left: number };

function pct(base: number, ratio: number) { return Math.round(base * ratio); }

// ─── imageSize helper ─────────────────────────────────────────────────────────
const SIZE_PX: Record<string, number> = { '1K': 1024, '2K': 2048, '4K': 4096 };

function pickImageSize(compositeW: number, compositeH: number, cap: string): string {
    const longSide = Math.max(compositeW, compositeH);
    const capPx = SIZE_PX[cap] ?? 1024;
    if (longSide <= 1024 && capPx >= 1024) return '1K';
    if (longSide <= 2048 && capPx >= 2048) return '2K';
    if (capPx >= 4096) return '4K';
    return cap;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface OutpaintModalProps {
    image: ImageElement;
    imageModel: string;
    imageSize: string;
    language: 'en' | 'zho';
    onClose: () => void;
    onGenerated: (items: GenerateImageItem[], expand: Expand) => void;
}

// ─── Canvas composite helpers ─────────────────────────────────────────────────
async function buildCompositeDataUrls(
    imgSrc: string,
    natW: number, natH: number,
    top: number, right: number, bottom: number, left: number
): Promise<{ inputDataUrl: string; maskDataUrl: string }> {
    const W = natW + left + right;
    const H = natH + top + bottom;

    const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = imgSrc;
    });

    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = W;
    inputCanvas.height = H;
    const ctx = inputCanvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(imgEl, left, top, natW, natH);
    const inputDataUrl = inputCanvas.toDataURL('image/png');

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = W;
    maskCanvas.height = H;
    const mctx = maskCanvas.getContext('2d')!;
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, W, H);
    mctx.fillStyle = '#000000';
    mctx.fillRect(left, top, natW, natH);
    const maskDataUrl = maskCanvas.toDataURL('image/png');

    return { inputDataUrl, maskDataUrl };
}

// ─── Drag handle types ────────────────────────────────────────────────────────
type DragEdge = 'top' | 'right' | 'bottom' | 'left' | 'tl' | 'tr' | 'bl' | 'br' | null;

// ─── Component ────────────────────────────────────────────────────────────────
export const OutpaintModal: React.FC<OutpaintModalProps> = ({
    image,
    imageModel,
    imageSize,
    language,
    onClose,
    onGenerated,
}) => {
    const isZho = language === 'zho';
    const natW = image.width;
    const natH = image.height;

    const [expand, setExpand] = useState<Expand>({ top: 0, right: 0, bottom: 0, left: 0 });
    const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].value);
    const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
    const [model, setModel] = useState(imageModel || 'gemini-3.1-flash-image-preview');
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);
    const [progress, setProgress] = useState('');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgBitmapRef = useRef<ImageBitmap | null>(null);
    const dragRef = useRef<{ edge: DragEdge; startX: number; startY: number; startExpand: Expand } | null>(null);

    // ─── Interactive canvas constants ─────────────────────────────
    const CANVAS_SIZE = 400; // interactive canvas pixel size
    const HANDLE_SIZE = 10;
    const MIN_MARGIN = 50; // fixed margin beyond outer rect for drag room (canvas px)

    // Dynamic scale: fit (image + current expansion + drag margins) into canvas
    // When expand is all 0, image fills ~85% of canvas; as user drags outward, view zooms out.
    function computeLayout(exp: Expand) {
        const contentW = natW + exp.left + exp.right;
        const contentH = natH + exp.top + exp.bottom;
        const sc = Math.min(
            (CANVAS_SIZE - MIN_MARGIN * 2) / contentW,
            (CANVAS_SIZE - MIN_MARGIN * 2) / contentH,
        );
        // Center the content area
        const contentCanvasW = contentW * sc;
        const contentCanvasH = contentH * sc;
        const contentX = (CANVAS_SIZE - contentCanvasW) / 2;
        const contentY = (CANVAS_SIZE - contentCanvasH) / 2;
        // Image position within the content
        const imgCX = contentX + exp.left * sc;
        const imgCY = contentY + exp.top * sc;
        const imgCW = natW * sc;
        const imgCH = natH * sc;
        // Outer rect = full content area
        const outerRect = { x: contentX, y: contentY, w: contentCanvasW, h: contentCanvasH };
        return { sc, imgCX, imgCY, imgCW, imgCH, outerRect };
    }

    // Current layout (used for hit-testing & cursor)
    const layout = computeLayout(expand);
    const viewScale = layout.sc;

    // Load image bitmap
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(image.href, { credentials: 'include' });
                const blob = await res.blob();
                const bmp = await createImageBitmap(blob);
                if (!cancelled) {
                    imgBitmapRef.current = bmp;
                    drawCanvas(expand);
                }
            } catch { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, [image.href]);

    // ─── Draw canvas ──────────────────────────────────────────────
    function drawCanvas(exp: Expand) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        const L = computeLayout(exp);
        const outer = L.outerRect;
        const hasExpand = exp.top > 0 || exp.right > 0 || exp.bottom > 0 || exp.left > 0;

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // Expansion area (checkerboard)
        if (hasExpand) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(outer.x, outer.y, outer.w, outer.h);
            ctx.rect(L.imgCX + L.imgCW, L.imgCY, -L.imgCW, L.imgCH);
            ctx.clip('evenodd');

            const SZ = 8;
            for (let row = 0; row * SZ < CANVAS_SIZE; row++) {
                for (let col = 0; col * SZ < CANVAS_SIZE; col++) {
                    ctx.fillStyle = (row + col) % 2 === 0 ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)';
                    ctx.fillRect(col * SZ, row * SZ, SZ, SZ);
                }
            }
            ctx.restore();
        }

        // Draw the image
        if (imgBitmapRef.current) {
            ctx.drawImage(imgBitmapRef.current, L.imgCX, L.imgCY, L.imgCW, L.imgCH);
        }

        // Image border
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(L.imgCX, L.imgCY, L.imgCW, L.imgCH);

        // Outer expansion border
        if (hasExpand) {
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(outer.x, outer.y, outer.w, outer.h);
            ctx.setLineDash([]);
        }

        // Draw handles on the OUTER border
        const handles = getHandlePositions(exp);
        for (const h of handles) {
            ctx.fillStyle = '#6366f1';
            ctx.fillRect(h.cx - HANDLE_SIZE / 2, h.cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(h.cx - HANDLE_SIZE / 2, h.cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }

        // Dimension labels
        if (hasExpand) {
            const outW = natW + exp.left + exp.right;
            const outH = natH + exp.top + exp.bottom;
            ctx.fillStyle = 'rgba(99,102,241,0.9)';
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${outW} × ${outH}`, outer.x + outer.w / 2, outer.y - 6);
        }
    }

    function getHandlePositions(exp: Expand) {
        const o = computeLayout(exp).outerRect;
        return [
            { edge: 'tl' as DragEdge, cx: o.x, cy: o.y },
            { edge: 'tr' as DragEdge, cx: o.x + o.w, cy: o.y },
            { edge: 'bl' as DragEdge, cx: o.x, cy: o.y + o.h },
            { edge: 'br' as DragEdge, cx: o.x + o.w, cy: o.y + o.h },
            { edge: 'top' as DragEdge, cx: o.x + o.w / 2, cy: o.y },
            { edge: 'bottom' as DragEdge, cx: o.x + o.w / 2, cy: o.y + o.h },
            { edge: 'left' as DragEdge, cx: o.x, cy: o.y + o.h / 2 },
            { edge: 'right' as DragEdge, cx: o.x + o.w, cy: o.y + o.h / 2 },
        ];
    }

    function hitTest(x: number, y: number, exp: Expand): DragEdge {
        const handles = getHandlePositions(exp);
        const R = HANDLE_SIZE + 4;
        for (const h of handles) {
            if (Math.abs(x - h.cx) < R && Math.abs(y - h.cy) < R) return h.edge;
        }
        const o = computeLayout(exp).outerRect;
        const EDGE_TOL = 8;
        if (Math.abs(y - o.y) < EDGE_TOL && x >= o.x && x <= o.x + o.w) return 'top';
        if (Math.abs(y - (o.y + o.h)) < EDGE_TOL && x >= o.x && x <= o.x + o.w) return 'bottom';
        if (Math.abs(x - o.x) < EDGE_TOL && y >= o.y && y <= o.y + o.h) return 'left';
        if (Math.abs(x - (o.x + o.w)) < EDGE_TOL && y >= o.y && y <= o.y + o.h) return 'right';
        return null;
    }

    function getCursorForEdge(edge: DragEdge): string {
        if (edge === 'top' || edge === 'bottom') return 'ns-resize';
        if (edge === 'left' || edge === 'right') return 'ew-resize';
        if (edge === 'tl' || edge === 'br') return 'nwse-resize';
        if (edge === 'tr' || edge === 'bl') return 'nesw-resize';
        return 'default';
    }

    function canvasCoords(e: React.MouseEvent): { x: number; y: number } {
        const rect = canvasRef.current!.getBoundingClientRect();
        const scaleX = CANVAS_SIZE / rect.width;
        const scaleY = CANVAS_SIZE / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    const handlePointerDown = useCallback((e: React.MouseEvent) => {
        const p = canvasCoords(e);
        const edge = hitTest(p.x, p.y, expand);
        if (!edge) return;
        e.preventDefault();
        dragRef.current = { edge, startX: p.x, startY: p.y, startExpand: { ...expand } };
    }, [expand, viewScale]);

    const handlePointerMove = useCallback((e: React.MouseEvent) => {
        const p = canvasCoords(e);
        if (!dragRef.current) {
            // Update cursor
            const edge = hitTest(p.x, p.y, expand);
            if (canvasRef.current) canvasRef.current.style.cursor = edge ? getCursorForEdge(edge) : 'default';
            return;
        }

        const d = dragRef.current;
        const dx = p.x - d.startX;
        const dy = p.y - d.startY;
        const se = d.startExpand;

        const clamp = (v: number) => Math.max(0, Math.round(v));
        const pxDx = dx / viewScale;
        const pxDy = dy / viewScale;

        let next = { ...se };
        switch (d.edge) {
            case 'top': next.top = clamp(se.top - pxDy); break;
            case 'bottom': next.bottom = clamp(se.bottom + pxDy); break;
            case 'left': next.left = clamp(se.left - pxDx); break;
            case 'right': next.right = clamp(se.right + pxDx); break;
            case 'tl': next.top = clamp(se.top - pxDy); next.left = clamp(se.left - pxDx); break;
            case 'tr': next.top = clamp(se.top - pxDy); next.right = clamp(se.right + pxDx); break;
            case 'bl': next.bottom = clamp(se.bottom + pxDy); next.left = clamp(se.left - pxDx); break;
            case 'br': next.bottom = clamp(se.bottom + pxDy); next.right = clamp(se.right + pxDx); break;
        }
        setExpand(next);
        drawCanvas(next);
    }, [expand, viewScale]);

    const handlePointerUp = useCallback(() => {
        dragRef.current = null;
    }, []);

    // Redraw on expand change (from presets)
    useEffect(() => {
        drawCanvas(expand);
    }, [expand]);

    function applyPreset(t: number, r: number, b: number, l: number) {
        const next = { top: t, right: r, bottom: b, left: l };
        setExpand(next);
    }

    function selectPromptPreset(idx: number) {
        setSelectedPresetIdx(idx);
        setPrompt(PRESET_PROMPTS[idx].value);
    }

    const canGenerate = (expand.top > 0 || expand.right > 0 || expand.bottom > 0 || expand.left > 0) && prompt.trim();

    const handleGenerate = async () => {
        if (!canGenerate || isGenerating) return;
        setIsGenerating(true);
        setGenError(null);
        setProgress(isZho ? '准备合成图像…' : 'Compositing images…');

        try {
            const { inputDataUrl, maskDataUrl } = await buildCompositeDataUrls(
                image.href, natW, natH,
                expand.top, expand.right, expand.bottom, expand.left
            );

            setProgress(isZho ? '正在生成扩图…' : 'Generating outpaint…');

            const imageRef: ClientImageRef = { kind: 'dataUrl', dataUrl: inputDataUrl, mimeType: 'image/png' };
            const maskRef: ClientImageRef = { kind: 'dataUrl', dataUrl: maskDataUrl, mimeType: 'image/png' };

            const compositeW = natW + expand.left + expand.right;
            const compositeH = natH + expand.top + expand.bottom;
            const resolvedImageSize = pickImageSize(compositeW, compositeH, imageSize);

            const results: GenerateImageItem[] = [];
            await editImageStream(
                prompt,
                [imageRef],
                maskRef,
                { imageModel: model, imageSize: resolvedImageSize as any },
                1,
                (item) => { results.push(item); },
                (produced, requested) => {
                    setProgress(isZho ? `生成中 ${produced}/${requested}…` : `Generating ${produced}/${requested}…`);
                }
            );

            if (results.length === 0) {
                throw new Error(isZho ? 'AI 未生成图像，请尝试更换提示词' : 'AI did not generate an image. Try a different prompt.');
            }

            onGenerated(results, expand);
        } catch (e) {
            setGenError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    const outW = natW + expand.left + expand.right;
    const outH = natH + expand.top + expand.bottom;

    // ─── Render ──────────────────────────────────────────────────────────────────
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.65)' }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="relative bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 flex"
                style={{ maxHeight: '92vh', maxWidth: '95vw', width: 820 }}
            >
                {/* ══════ LEFT: interactive canvas ══════ */}
                <div className="flex flex-col items-center gap-3 p-5 border-r border-gray-700" style={{ width: 440, minHeight: 460 }}>
                    {/* Header */}
                    <div className="flex items-center gap-2 self-start">
                        <span style={{ fontSize: 18 }}>🔲</span>
                        <span className="text-white font-semibold text-sm">
                            {isZho ? '扩图' : 'Outpaint'}
                        </span>
                    </div>

                    {/* Canvas */}
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_SIZE}
                        height={CANVAS_SIZE}
                        onMouseDown={handlePointerDown}
                        onMouseMove={handlePointerMove}
                        onMouseUp={handlePointerUp}
                        onMouseLeave={handlePointerUp}
                        style={{ width: 380, height: 380, borderRadius: 12, background: '#1a1a2e', userSelect: 'none' }}
                    />

                    {/* Size info */}
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{isZho ? '原图' : 'Original'}: <span className="text-gray-200 font-mono">{natW}×{natH}</span></span>
                        <span>→</span>
                        <span>{isZho ? '扩图' : 'Output'}: <span className="text-indigo-400 font-mono">{outW}×{outH}</span></span>
                    </div>

                    {/* Per-side px readout */}
                    <div className="flex gap-3 text-xs text-gray-500">
                        <span>↑{expand.top}</span>
                        <span>↓{expand.bottom}</span>
                        <span>←{expand.left}</span>
                        <span>→{expand.right}</span>
                    </div>
                </div>

                {/* ══════ RIGHT: settings ══════ */}
                <div className="flex flex-col gap-4 p-5 flex-1 overflow-y-auto" style={{ maxHeight: '92vh' }}>
                    {/* Close button */}
                    <div className="flex justify-end">
                        <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>

                    {/* Quick presets */}
                    <div>
                        <p className="text-gray-400 text-xs mb-2">{isZho ? '快速预设' : 'Quick Presets'}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {[
                                { label: isZho ? '全四周 50%' : 'All 50%', fn: () => applyPreset(pct(natH, 0.5), pct(natW, 0.5), pct(natH, 0.5), pct(natW, 0.5)) },
                                { label: isZho ? '左右' : 'L & R', fn: () => applyPreset(0, pct(natW, 0.5), 0, pct(natW, 0.5)) },
                                { label: isZho ? '上下' : 'T & B', fn: () => applyPreset(pct(natH, 0.5), 0, pct(natH, 0.5), 0) },
                                { label: isZho ? '向右' : 'Right', fn: () => applyPreset(0, pct(natW, 1.0), 0, 0) },
                                { label: isZho ? '向下' : 'Down', fn: () => applyPreset(0, 0, pct(natH, 1.0), 0) },
                                {
                                    label: '16:9', fn: () => {
                                        const targetW = Math.round(natH * 16 / 9);
                                        const pad = Math.max(0, targetW - natW);
                                        applyPreset(0, Math.ceil(pad / 2), 0, Math.floor(pad / 2));
                                    }
                                },
                                {
                                    label: isZho ? '重置' : 'Reset', fn: () => applyPreset(0, 0, 0, 0)
                                },
                            ].map((p, i) => (
                                <button key={i} onClick={p.fn}
                                    className="px-2 py-1 text-xs rounded-md bg-gray-700 hover:bg-indigo-600 text-gray-200 hover:text-white transition-colors">
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Prompt presets */}
                    <div>
                        <p className="text-gray-400 text-xs mb-2">{isZho ? '提示词预设' : 'Prompt Presets'}</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {PRESET_PROMPTS.map((p, i) => (
                                <button key={i} onClick={() => selectPromptPreset(i)}
                                    className={`px-2 py-1 text-xs rounded-full transition-colors ${selectedPresetIdx === i ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
                                    {isZho ? p.label : p.labelEn}
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={prompt}
                            onChange={e => { setPrompt(e.target.value); setSelectedPresetIdx(-1); }}
                            rows={3}
                            placeholder={isZho ? '或输入自定义提示词…' : 'Or enter a custom prompt…'}
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                        />
                    </div>

                    {/* Model */}
                    <div className="flex items-center gap-3">
                        <label className="text-gray-400 text-xs shrink-0">{isZho ? '模型' : 'Model'}</label>
                        <select
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-indigo-500"
                        >
                            <option value="gemini-3.1-flash-image-preview">Flash</option>
                            <option value="gemini-3-pro-image-preview">Pro</option>
                        </select>
                    </div>

                    {/* Error */}
                    {genError && (
                        <div className="bg-red-900/50 border border-red-500 rounded-lg px-3 py-2 text-xs text-red-300">
                            {genError}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-3 mt-auto pt-2">
                        <span className="text-gray-500 text-xs truncate">{progress}</span>
                        <div className="flex gap-2 shrink-0">
                            <button onClick={onClose} disabled={isGenerating}
                                className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50">
                                {isZho ? '取消' : 'Cancel'}
                            </button>
                            <button onClick={handleGenerate} disabled={!canGenerate || isGenerating}
                                className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${canGenerate && !isGenerating ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}>
                                {isGenerating
                                    ? (isZho ? '生成中…' : 'Generating…')
                                    : (isZho ? '生成扩图' : 'Generate')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
