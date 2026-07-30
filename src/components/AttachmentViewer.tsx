import React, { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileEntry, useVault } from "../contexts/VaultContext";
import { 
  FileText, Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, 
  Trash2, ExternalLink, FolderOpen, ZoomIn, ZoomOut, RotateCw, RefreshCw
} from "lucide-react";
import { invokeIPC } from "../lib/ipc";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";

interface AttachmentViewerProps {
  file: FileEntry;
}

export const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ file }) => {
  const { deleteFileOrDirectory } = useVault();
  const [zoom, setZoom] = useState(100);
  const [rotate, setRotate] = useState(0);

  const ext = file.name.toLowerCase().split('.').pop() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext);
  const isAudio = ['mp3', 'wav', 'm4a'].includes(ext);
  const isVideo = ['mp4', 'mov'].includes(ext);
  const isPdf = ext === 'pdf';

  const assetSrc = convertFileSrc(file.path);

  const handleReveal = () => {
    invokeIPC("reveal_in_finder", { path: file.path }).catch(console.error);
  };

  const handleOpenDefault = () => {
    invokeIPC("open_with_default", { path: file.path }).catch(console.error);
  };

  const handleDelete = async () => {
    const confirmed = await tauriConfirm(`Are you sure you want to delete this attachment: ${file.name}?`, {
      title: "Delete Attachment",
      kind: "warning",
    });
    if (confirmed) {
      deleteFileOrDirectory(file.path);
    }
  };

  const renderContent = () => {
    if (isImage) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center overflow-auto p-8 min-h-0">
          {/* Zoom/Rotate Controls */}
          <div className="flex items-center gap-3 bg-card/90 border border-card-border px-4 py-2 rounded-full mb-6 shadow-lg z-10 text-xs">
            <button 
              type="button"
              onClick={() => setZoom(z => Math.max(25, z - 25))} 
              className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-slate-300 font-bold min-w-11.25 text-center">{zoom}%</span>
            <button 
              type="button"
              onClick={() => setZoom(z => Math.min(400, z + 25))} 
              className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <div className="w-px bg-card-border h-4 self-center mx-1" />
            <button 
              type="button"
              onClick={() => setRotate(r => (r + 90) % 360)} 
              className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              title="Rotate 90°"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button 
              type="button"
              onClick={() => { setZoom(100); setRotate(0); }} 
              className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              title="Reset View"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-auto scrollbar-thin">
            <img 
              src={assetSrc} 
              alt={file.name} 
              style={{
                transform: `scale(${zoom / 100}) rotate(${rotate}deg)`,
                transition: 'transform 0.15s ease-out',
                maxWidth: '90%',
                maxHeight: '80%'
              }}
              className="object-contain rounded-lg border border-card-border bg-sidebar shadow-2xl"
            />
          </div>
        </div>
      );
    }

    if (isVideo) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 bg-black/30 min-h-0">
          <video 
            src={assetSrc} 
            controls 
            autoPlay
            className="max-w-full max-h-full rounded-xl border border-card-border shadow-2xl bg-black"
          />
        </div>
      );
    }

    if (isAudio) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 min-h-0">
          <div className="w-full max-w-lg rounded-2xl border border-card-border bg-card/60 p-8 shadow-2xl backdrop-blur-md text-center flex flex-col items-center gap-6">
            <div className="p-6 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
              <MusicIcon className="h-12 w-12" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200 truncate max-w-sm">{file.name}</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1.5">Audio Attachment Player</p>
            </div>
            
            <audio 
              src={assetSrc} 
              controls 
              autoPlay
              className="w-full mt-4 text-indigo-500" 
            />
          </div>
        </div>
      );
    }

    if (isPdf) {
      return (
        <div className="flex-1 h-full w-full p-4 min-h-0 bg-background">
          <iframe 
            src={assetSrc} 
            className="w-full h-full rounded-xl border border-card-border shadow-2xl"
            title={file.name}
          />
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
        <FileText className="h-12 w-12 text-slate-600 mb-4 animate-bounce" />
        <h3 className="text-sm font-semibold text-slate-300">Unsupported preview format</h3>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          This attachment type cannot be previewed natively in the app. Use the controls above to reveal in Finder or open with system applications.
        </p>
      </div>
    );
  };

  const getIcon = () => {
    if (isImage) return <ImageIcon className="h-5 w-5 text-emerald-400" />;
    if (isVideo) return <VideoIcon className="h-5 w-5 text-amber-400" />;
    if (isAudio) return <MusicIcon className="h-5 w-5 text-indigo-400" />;
    if (isPdf) return <FileText className="h-5 w-5 text-rose-400" />;
    return <FileText className="h-5 w-5 text-slate-400" />;
  };

  return (
    <div className="flex flex-col h-full w-full bg-background text-slate-200 select-none overflow-hidden animate-fade-in">
      {/* Header Info Panel */}
      <div className="h-14 border-b border-card-border bg-sidebar px-6 flex items-center justify-between shrink-0 animate-fade-in">
        <div className="flex items-center gap-3 min-w-0">
          {getIcon()}
          <div className="min-w-0">
            <h2 className="text-xs font-extrabold text-slate-200 truncate tracking-wide max-w-md">{file.name}</h2>
            <p className="text-[9px] text-slate-500 font-mono truncate max-w-lg mt-0.5" title={file.path}>
              {file.path}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={handleOpenDefault}
            className="px-3 py-1.5 rounded-md border border-card-border bg-card text-[10px] font-bold text-slate-300 hover:text-slate-100 hover:bg-card-hover transition-colors flex items-center gap-1 cursor-pointer"
            title="Open using default method set in OS"
          >
            <ExternalLink className="h-3 w-3" />
            Open in default app
          </button>
          <button 
            type="button"
            onClick={handleReveal}
            className="px-3 py-1.5 rounded-md border border-card-border bg-card text-[10px] font-bold text-slate-300 hover:text-slate-100 hover:bg-card-hover transition-colors flex items-center gap-1 cursor-pointer"
            title="Show file in Finder / File Explorer"
          >
            <FolderOpen className="h-3 w-3" />
            Reveal in Finder
          </button>
          <div className="w-px bg-card-border h-5 self-center mx-1" />
          <button 
            type="button"
            onClick={handleDelete}
            className="p-2 rounded-md hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
            title="Delete this attachment permanently"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      {renderContent()}
    </div>
  );
};

