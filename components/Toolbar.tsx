
import React, { useState, useRef, useEffect } from 'react';
import type { Tool } from '../types';

interface ToolbarProps {
    t: (key: string) => string;
    activeTool: Tool;
    setActiveTool: (tool: Tool) => void;
    drawingOptions: { strokeColor: string; strokeWidth: number };
    setDrawingOptions: (options: { strokeColor: string; strokeWidth: number }) => void;
    onUpload: (file: File) => void;
    isCropping: boolean;
    onConfirmCrop: () => void;
    onCancelCrop: () => void;
    onSettingsClick: () => void;
    onLayersClick: () => void;
    onBoardsClick: () => void;
    onHistoryClick: () => void;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

const ToolButton: React.FC<{
    label: string;
    icon: JSX.Element;
    isActive?: boolean;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
}> = ({ label, icon, isActive = false, onClick, disabled = false, className = '' }) => (
    <button
        onClick={onClick}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={`p-2 rounded-md transition-colors duration-200 text-white ${
            isActive ? 'bg-blue-500' : 'hover:bg-white/20'
        } disabled:text-white/40 disabled:hover:bg-transparent disabled:cursor-not-allowed ${className}`}
    >
        {icon}
    </button>
);


const ToolGroupButton: React.FC<{
    activeTool: Tool;
    setActiveTool: (tool: Tool) => void;
    tools: { id: Tool; label: string; icon: JSX.Element }[];
    groupIcon: JSX.Element;
    groupLabel: string;
}> = ({ activeTool, setActiveTool, tools, groupIcon, groupLabel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const activeToolInGroup = tools.find(t => t.id === activeTool);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToolSelect = (toolId: Tool) => {
        setActiveTool(toolId);
        setIsOpen(false);
    };

    return (
        <div className="relative flex-shrink-0" ref={wrapperRef}>
            <ToolButton
                label={activeToolInGroup ? activeToolInGroup.label : groupLabel}
                icon={activeToolInGroup ? activeToolInGroup.icon : groupIcon}
                isActive={!!activeToolInGroup}
                onClick={() => setIsOpen(prev => !prev)}
            />
            {isOpen && (
                <div className="absolute left-full top-0 ml-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1">
                    {tools.map(tool => (
                        <ToolButton
                            key={tool.id}
                            label={tool.label}
                            icon={tool.icon}
                            isActive={activeTool === tool.id}
                            onClick={() => handleToolSelect(tool.id)}
                            className="bg-white/10"
                        />
                    ))}
                </div>
            )}
        </div>
    );
};


export const Toolbar: React.FC<ToolbarProps> = ({
    t,
    activeTool,
    setActiveTool,
    drawingOptions,
    setDrawingOptions,
    onUpload,
    isCropping,
    onConfirmCrop,
    onCancelCrop,
    onSettingsClick,
    onLayersClick,
    onBoardsClick,
    onHistoryClick,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
}) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const handleUploadClick = () => fileInputRef.current?.click();
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUpload(e.target.files[0]);
            e.target.value = '';
        }
    };

    const containerStyle: React.CSSProperties = {
        backgroundColor: `var(--ui-bg-color)`,
    };

    if (isCropping) {
        return (
            <div 
                style={containerStyle}
                className="absolute top-1/2 left-4 -translate-y-1/2 z-10 px-2 py-4 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex flex-col items-center space-y-2 w-[88px]"
            >
                <span className="text-sm font-medium text-white">{t('toolbar.crop.title')}</span>
                <div className="w-full h-px bg-white/30 my-2"></div>
                <button onClick={onCancelCrop} className="px-4 py-1.5 text-sm rounded-md bg-white/20 text-white hover:bg-white/30 border border-white/30 w-full">{t('toolbar.crop.cancel')}</button>
                <button onClick={onConfirmCrop} className="px-4 py-1.5 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 w-full">{t('toolbar.crop.confirm')}</button>
            </div>
        )
    }

    const mainTools: { id: Tool; label: string; icon: JSX.Element }[] = [
        { id: 'select', label: t('toolbar.select'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg> },
        { id: 'pan', label: t('toolbar.pan'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg> },
    ];
    
     const shapeTools: { id: Tool; label: string; icon: JSX.Element }[] = [
        { id: 'rectangle', label: t('toolbar.rectangle'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg> },
        { id: 'circle', label: t('toolbar.circle'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg> },
        { id: 'triangle', label: t('toolbar.triangle'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg> },
        { id: 'line', label: t('toolbar.line'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5"></line></svg> },
        { id: 'arrow', label: t('toolbar.arrow'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg> },
    ];

     const drawingTools: { id: Tool; label: string; icon: JSX.Element }[] = [
        { id: 'draw', label: t('toolbar.draw'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> },
        { id: 'highlighter', label: t('toolbar.highlighter'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18.37 2.63 1.4 1.4a2 2 0 0 1 0 2.82L5.23 21.37a2.82 2.82 0 0 1-4-4L15.55 2.63a2 2 0 0 1 2.82 0Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8v2"/></svg>},
        { id: 'lasso', label: t('toolbar.lasso'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="12" rx="8" ry="5" strokeDasharray="3 3" transform="rotate(-30 12 12)"/></svg>},
        { id: 'erase', label: t('toolbar.erase'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7Z"/><path d="M22 21H7"/><path d="m5 12 5 5"/></svg> },
    ];

    const miscTools: { id: Tool; label: string; icon: JSX.Element }[] = [
        { id: 'text', label: t('toolbar.text'), icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg> },
    ];

    return (
        <div 
            style={containerStyle}
            className="absolute top-1/2 left-4 -translate-y-1/2 z-10 px-2 py-4 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex flex-col items-center gap-2"
        >
            <ToolButton label="Boards" onClick={onBoardsClick} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>} />
            <ToolButton label="History" onClick={onHistoryClick} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"></path><polyline points="21 3 21 9 15 9"></polyline><path d="M12 7v5l3 3"></path></svg>} />
            <ToolButton label={t('toolbar.layers')} onClick={onLayersClick} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>} />
            <ToolButton label={t('toolbar.settings')} onClick={onSettingsClick} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>} />

            <div className="w-10 h-px bg-white/30"></div>
            
            <div className="flex flex-col items-center gap-2 flex-grow">
                 {mainTools.map(tool => (
                    <ToolButton key={tool.id} label={tool.label} icon={tool.icon} isActive={activeTool === tool.id} onClick={() => setActiveTool(tool.id)} />
                ))}

                <ToolGroupButton 
                    activeTool={activeTool} 
                    setActiveTool={setActiveTool} 
                    tools={shapeTools} 
                    groupLabel={t('toolbar.shapes')}
                    groupIcon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>}
                />

                <ToolGroupButton 
                    activeTool={activeTool} 
                    setActiveTool={setActiveTool} 
                    tools={drawingTools} 
                    groupLabel={t('toolbar.drawingTools')}
                    groupIcon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>}
                />

                {miscTools.map(tool => (
                    <ToolButton key={tool.id} label={tool.label} icon={tool.icon} isActive={activeTool === tool.id} onClick={() => setActiveTool(tool.id)} />
                ))}

                <div className="w-10 h-px bg-white/30"></div>
                <input type="color" aria-label={t('toolbar.strokeColor')} title={t('toolbar.strokeColor')} value={drawingOptions.strokeColor} onChange={(e) => setDrawingOptions({ ...drawingOptions, strokeColor: e.target.value })} className="w-8 h-8 p-0 border border-white/30 rounded-md cursor-pointer bg-transparent" />
                <input type="range" min="1" max="50" value={drawingOptions.strokeWidth} aria-label={t('toolbar.strokeWidth')} title={t('toolbar.strokeWidth')} onChange={(e) => setDrawingOptions({ ...drawingOptions, strokeWidth: parseInt(e.target.value, 10) })} className="w-10 cursor-pointer" />
                <span className="text-sm text-white w-6 text-center">{drawingOptions.strokeWidth}</span>
                <div className="w-10 h-px bg-white/30"></div>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                <ToolButton label={t('toolbar.upload')} onClick={handleUploadClick} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>} />
            </div>

            <div className="w-10 h-px bg-white/30"></div>
            <ToolButton label={t('toolbar.undo')} onClick={onUndo} disabled={!canUndo} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>} />
            <ToolButton label={t('toolbar.redo')} onClick={onRedo} disabled={!canRedo} icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>} />
        </div>
    );
};
