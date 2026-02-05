'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileText, Sparkles, Play, Loader2 } from 'lucide-react';
import { useOrchestratorStore } from '@/stores/orchestratorStore';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8811/api';

interface PromptInputProps {
  onHoverChange?: (hovering: boolean) => void;
}

export function PromptInput({ onHoverChange }: PromptInputProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { 
    userRequest, 
    setUserRequest, 
    documents, 
    addDocument, 
    removeDocument,
    generateGraph,
    runInInvene,
    taskGraph,
    isGenerating,
    isRunning,
  } = useOrchestratorStore();
  
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      if (file.type === 'application/pdf') {
        setIsUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', file);
          
          const response = await fetch(`${API_BASE}/documents/upload`, {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) throw new Error('Upload failed');
          
          const data = await response.json();
          addDocument({
            docId: data.doc_id,
            filename: data.filename,
            extractedSummary: data.extracted_summary,
            chunkRefs: data.chunk_refs,
          });
        } catch (error) {
          console.error('Failed to upload PDF:', error);
          addDocument({
            docId: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filename: file.name,
            extractedSummary: `[PDF: ${file.name} - extraction failed]`,
          });
        } finally {
          setIsUploading(false);
        }
      }
    }
  }, [addDocument]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    noClick: true,
  });
  
  return (
    <div className="space-y-4">
      {/* Input Section */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-white">
          What do you want to build?
        </label>
        <div {...getRootProps()} className="relative">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder="Make an app. Add OAuth. Make a landing page. Add local DB."
            className="w-full min-h-[140px] px-3 py-2 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
          />
          <input {...getInputProps()} />
          {isDragActive && (
            <div className="absolute inset-0 bg-white/10 border-2 border-dashed border-white/40 rounded-md flex items-center justify-center">
              <p className="text-white/80">Drop PDFs here</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Documents */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-white/60">Attached documents</label>
          {documents.map((doc) => (
            <div 
              key={doc.docId}
              className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-md"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-white/40" />
                <span className="text-sm text-white/80 truncate max-w-[200px]">{doc.filename}</span>
              </div>
              <button 
                onClick={() => removeDocument(doc.docId)}
                className="p-1 hover:bg-white/10 rounded transition-colors"
              >
                <X className="w-3 h-3 text-white/60" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Upload PDFs */}
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <button 
          disabled={isUploading}
          className="flex items-center gap-2 text-sm text-white/60 hover:text-white/80 transition-colors disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          <span>{isUploading ? 'Uploading...' : 'Upload PDFs (optional)'}</span>
        </button>
      </div>

      {/* Build Button - Main CTA */}
      <button
        onClick={() => {
          console.log('[DEBUG] PromptInput: Build button clicked, userRequest:', userRequest.slice(0, 30) + '...');
          generateGraph();
        }}
        disabled={isGenerating || !userRequest.trim()}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        className="w-full h-14 relative uppercase border border-white font-mono cursor-pointer flex items-center justify-center gap-2 font-medium transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 bg-black text-white hover:bg-white/5 [clip-path:polygon(12px_0,calc(100%-12px)_0,100%_0,100%_calc(100%-12px),calc(100%-12px)_100%,0_100%,0_calc(100%-12px),0_12px)]"
        style={{
          boxShadow: isGenerating ? 'inset 0 0 54px 0px rgba(59, 130, 246, 0.5)' : 'inset 0 0 54px 0px rgba(235, 184, 0, 0.3)',
        }}
      >
        {/* Corner accents */}
        <span className="absolute w-[20px] top-[4px] left-[4px] h-[2px] -rotate-45 origin-top -translate-x-1/2 bg-white" />
        <span className="absolute w-[20px] bottom-[4px] right-[4px] h-[2px] -rotate-45 translate-x-1/2 bg-white" />
        
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Building...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Build
          </>
        )}
      </button>

      {/* Run Button - appears after graph is generated */}
      {taskGraph && taskGraph.nodes.length > 0 && !isGenerating && (
        <button
          onClick={() => {
            console.log('[DEBUG] PromptInput: Execute button clicked');
            runInInvene();
          }}
          disabled={isRunning}
          className="w-full h-12 relative uppercase border border-green-500/50 font-mono cursor-pointer flex items-center justify-center gap-2 font-medium transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 bg-black text-green-400 hover:bg-green-500/10"
          style={{
            boxShadow: 'inset 0 0 30px 0px rgba(34, 197, 94, 0.2)',
          }}
        >
          <Play className="w-4 h-4" />
          {isRunning ? 'Running...' : 'Execute in Desktop'}
        </button>
      )}
    </div>
  );
}
