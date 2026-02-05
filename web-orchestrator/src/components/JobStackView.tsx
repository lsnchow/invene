'use client';

import { useState, useEffect } from 'react';

// ============================================================================
// Types
// ============================================================================

interface JobSpec {
  job_id: string;
  title: string;
  objective: string;
  scope_included: string[];
  scope_excluded: string[];
  constraints: string[];
  success_criteria: string[];
  verification_commands: string[];
  dependencies: string[];
  estimated_iterations: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
}

interface JobStack {
  stack_id: string;
  jobs: JobSpec[];
  execution_order: string[];
  total_jobs: number;
}

// ============================================================================
// API
// ============================================================================

const API_BASE = 'http://localhost:8811';

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  context_limit?: number;
  supports_tools?: boolean;
}

interface ConversationStep {
  step_id: string;
  type: 'user_input' | 'system_prompt' | 'prompt' | 'ai_response' | 'parsing' | 'error' | 'fallback' | 'result';
  title: string;
  content: string;
  timestamp: string;
  model?: string;
  tokens?: number;
}

interface InterpretResult extends JobStack {
  conversation: ConversationStep[];
}

async function fetchModels(): Promise<ModelOption[]> {
  const response = await fetch(`${API_BASE}/api/jobs/models`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.models || [];
}

async function uploadDocument(file: File): Promise<{ thread_id: string; filename: string }> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${API_BASE}/api/jobs/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) throw new Error('Upload failed');
  return response.json();
}

async function interpretRequest(
  userRequest: string,
  verbosity: 'low' | 'medium' | 'high' = 'medium',
  model?: string,
  threadId?: string
): Promise<InterpretResult> {
  const response = await fetch(`${API_BASE}/api/jobs/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      user_request: userRequest, 
      verbosity,
      model: model || undefined,
      thread_id: threadId || undefined,
    }),
  });
  
  if (!response.ok) throw new Error(`Failed: ${response.status}`);
  return response.json();
}

// ============================================================================
// Sub-components
// ============================================================================

function EditableField({ 
  label, 
  value, 
  onChange,
  multiline = false,
}: { 
  label: string; 
  value: string; 
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  
  if (editing) {
    return (
      <div className="space-y-1">
        <label className="text-xs text-white/40">{label}</label>
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            autoFocus
            className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-sm text-white resize-none focus:outline-none focus:border-white/40"
            rows={3}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
            autoFocus
            className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-sm text-white focus:outline-none focus:border-white/40"
          />
        )}
      </div>
    );
  }
  
  return (
    <div 
      className="space-y-1 cursor-pointer group"
      onClick={() => setEditing(true)}
    >
      <label className="text-xs text-white/40">{label}</label>
      <p className="text-sm text-white/80 group-hover:text-white transition-colors">
        {value || <span className="text-white/30 italic">Click to edit</span>}
      </p>
    </div>
  );
}

function EditableList({
  label,
  items,
  onChange,
  icon = '•',
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  icon?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState('');
  
  const addItem = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem('');
    }
  };
  
  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-white/40">{label}</label>
        <button
          onClick={() => setEditing(!editing)}
          className="text-xs text-white/30 hover:text-white/60"
        >
          {editing ? 'done' : 'edit'}
        </button>
      </div>
      
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-white/70">
            <span className="text-white/40">{icon}</span>
            <span className="flex-1">{item}</span>
            {editing && (
              <button
                onClick={() => removeItem(i)}
                className="text-red-400/60 hover:text-red-400 text-xs"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      
      {editing && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add item..."
            className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/20"
          />
          <button
            onClick={addItem}
            className="px-2 py-1 bg-white/10 rounded text-xs text-white/60 hover:text-white"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  index,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
}: {
  job: JobSpec;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (job: JobSpec) => void;
  onDelete: () => void;
}) {
  const statusColors = {
    pending: 'border-white/10 bg-white/5',
    running: 'border-blue-500/50 bg-blue-500/10',
    completed: 'border-green-500/50 bg-green-500/10',
    failed: 'border-red-500/50 bg-red-500/10',
    blocked: 'border-yellow-500/50 bg-yellow-500/10',
  };
  
  const statusIcons = {
    pending: '○',
    running: '●',
    completed: '✓',
    failed: '✗',
    blocked: '⊘',
  };
  
  return (
    <div className={`rounded-lg border ${statusColors[job.status]} overflow-hidden transition-all`}>
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-white/30 text-sm w-6">{index + 1}</span>
        <span className={`${job.status === 'running' ? 'animate-pulse text-blue-400' : 'text-white/50'}`}>
          {statusIcons[job.status]}
        </span>
        <span className="flex-1 text-white font-medium">{job.title}</span>
        <span className="text-xs text-white/30">~{job.estimated_iterations} iter</span>
        <span className="text-white/30">{expanded ? '▼' : '▶'}</span>
      </button>
      
      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10">
          <div className="pt-4">
            <EditableField
              label="Objective"
              value={job.objective}
              onChange={(v) => onUpdate({ ...job, objective: v })}
              multiline
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <EditableList
              label="In Scope"
              items={job.scope_included}
              onChange={(items) => onUpdate({ ...job, scope_included: items })}
              icon="+"
            />
            <EditableList
              label="Out of Scope"
              items={job.scope_excluded}
              onChange={(items) => onUpdate({ ...job, scope_excluded: items })}
              icon="-"
            />
          </div>
          
          <EditableList
            label="Constraints"
            items={job.constraints}
            onChange={(items) => onUpdate({ ...job, constraints: items })}
            icon="⚠"
          />
          
          <EditableList
            label="Success Criteria"
            items={job.success_criteria}
            onChange={(items) => onUpdate({ ...job, success_criteria: items })}
            icon="✓"
          />
          
          <EditableList
            label="Verification Commands"
            items={job.verification_commands}
            onChange={(items) => onUpdate({ ...job, verification_commands: items })}
            icon="$"
          />
          
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <div className="flex items-center gap-4">
              <label className="text-xs text-white/40">Est. Iterations</label>
              <input
                type="number"
                min={1}
                max={20}
                value={job.estimated_iterations}
                onChange={(e) => onUpdate({ ...job, estimated_iterations: parseInt(e.target.value) || 5 })}
                className="w-16 px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none"
              />
            </div>
            <button
              onClick={onDelete}
              className="text-xs text-red-400/60 hover:text-red-400"
            >
              Delete Job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface JobStackViewProps {
  initialPrompt?: string;
}

export function JobStackView({ initialPrompt = '' }: JobStackViewProps) {
  const [input, setInput] = useState(initialPrompt);
  const [isLoading, setIsLoading] = useState(false);
  const [jobStack, setJobStack] = useState<JobStack | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [verbosity, setVerbosity] = useState<'low' | 'medium' | 'high'>('medium');
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  
  // Model selection
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  // Document upload
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; threadId: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Conversation transparency
  const [conversation, setConversation] = useState<ConversationStep[]>([]);
  const [showConversation, setShowConversation] = useState(false);
  
  // Load available models on mount
  useEffect(() => {
    fetchModels().then(setModels);
  }, []);
  
  // Pre-fill input if initialPrompt is provided (but don't auto-generate)
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setInput(initialPrompt);
      // Don't auto-interpret - let user adjust settings first
    }
  }, [initialPrompt]);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setError(null);
    
    try {
      const result = await uploadDocument(file);
      setUploadedFiles(prev => [...prev, { name: result.filename, threadId: result.thread_id }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      e.target.value = ''; // Reset input
    }
  };
  
  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };
  
  const handleInterpretWithPrompt = async (prompt: string) => {
    if (!prompt.trim()) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Use the latest uploaded file's thread if available
      const threadId = uploadedFiles.length > 0 ? uploadedFiles[uploadedFiles.length - 1].threadId : undefined;
      const result = await interpretRequest(prompt, verbosity, selectedModel || undefined, threadId);
      setJobStack(result);
      // Save conversation for transparency view
      if (result.conversation) {
        setConversation(result.conversation);
      }
      if (result.jobs.length > 0) {
        setExpandedJob(result.jobs[0].job_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to interpret');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleInterpret = async () => {
    await handleInterpretWithPrompt(input);
  };
  
  const updateJob = (jobId: string, updatedJob: JobSpec) => {
    if (!jobStack) return;
    setJobStack({
      ...jobStack,
      jobs: jobStack.jobs.map(j => j.job_id === jobId ? updatedJob : j),
    });
  };
  
  const deleteJob = (jobId: string) => {
    if (!jobStack) return;
    setJobStack({
      ...jobStack,
      jobs: jobStack.jobs.filter(j => j.job_id !== jobId),
      total_jobs: jobStack.total_jobs - 1,
      execution_order: jobStack.execution_order.filter(id => id !== jobId),
    });
  };
  
  const addJob = () => {
    if (!jobStack) return;
    const newJob: JobSpec = {
      job_id: `job-${String(jobStack.jobs.length + 1).padStart(3, '0')}`,
      title: 'New Job',
      objective: '',
      scope_included: [],
      scope_excluded: [],
      constraints: [],
      success_criteria: [],
      verification_commands: [],
      dependencies: [],
      estimated_iterations: 5,
      status: 'pending',
    };
    setJobStack({
      ...jobStack,
      jobs: [...jobStack.jobs, newJob],
      total_jobs: jobStack.total_jobs + 1,
      execution_order: [...jobStack.execution_order, newJob.job_id],
    });
    setExpandedJob(newJob.job_id);
  };
  
  const sendToElectron = async () => {
    if (!jobStack) return;
    
    try {
      // Send confirmed jobs to backend API (Electron will poll for them)
      const confirmedData = {
        ...jobStack,
        jobs: jobStack.jobs.map(j => ({ ...j, status: 'pending' as const })),
      };
      
      const response = await fetch(`${API_BASE}/api/jobs/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_stack: confirmedData }),
      });
      
      if (!response.ok) throw new Error('Failed to confirm jobs');
      
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to confirm');
    }
  };
  
  // No job stack yet - show input
  if (!jobStack) {
    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm text-white/60 mb-2 block">
            What do you want to build?
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleInterpret();
              }
            }}
            placeholder="Describe your project... e.g., 'a dog dating app with swipe matching and user profiles'"
            className="w-full h-32 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/20"
            disabled={isLoading}
          />
        </div>
        
        {/* Model selector */}
        {models.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
              disabled={isLoading}
            >
              <option value="" className="bg-zinc-900">Default (Nova Micro)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id} className="bg-zinc-900">
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        
        {/* Document upload */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Documents:</span>
            <label className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${
              isUploading ? 'bg-white/5 text-white/30' : 'bg-white/10 text-white/60 hover:text-white hover:bg-white/20'
            }`}>
              {isUploading ? 'Uploading...' : '+ Add file'}
              <input
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.txt,.md,.doc,.docx"
                disabled={isUploading || isLoading}
              />
            </label>
          </div>
          
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 bg-white/10 rounded text-xs text-white/70">
                  <span>📄 {f.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-white/40 hover:text-white/60 ml-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Verbosity selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">Detail level:</span>
          {(['low', 'medium', 'high'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVerbosity(v)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                verbosity === v
                  ? 'bg-white/20 text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        
        <button
          onClick={handleInterpret}
          disabled={isLoading || !input.trim()}
          className={`w-full py-3 rounded-lg font-medium transition-all ${
            isLoading || !input.trim()
              ? 'bg-white/5 text-white/30 cursor-not-allowed'
              : 'bg-white text-black hover:bg-white/90'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-transparent rounded-full animate-spin" />
              Interpreting...
            </span>
          ) : (
            'Generate Job Stack'
          )}
        </button>
        
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}
        
        <p className="text-xs text-white/30 text-center">
          ⌘ + Enter to generate
        </p>
      </div>
    );
  }
  
  // Show job stack
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white">Job Stack</h2>
          <p className="text-xs text-white/40">
            {jobStack.total_jobs} jobs • Click to expand & edit
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conversation.length > 0 && (
            <button
              onClick={() => setShowConversation(!showConversation)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                showConversation
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {showConversation ? '◀ Hide AI Flow' : '▶ Show AI Flow'}
            </button>
          )}
          <button
            onClick={() => { setJobStack(null); setConversation([]); setShowConversation(false); }}
            className="text-xs text-white/40 hover:text-white/60"
          >
            Start Over
          </button>
        </div>
      </div>
      
      {/* Conversation Flow (Transparency) */}
      {showConversation && conversation.length > 0 && (
        <div className="p-4 bg-white/5 rounded-lg border border-white/10 space-y-3">
          <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
            <span className="text-blue-400">🔍</span> AI Conversation Flow
          </h3>
          <div className="space-y-2">
            {conversation.map((step, i) => (
              <div key={step.step_id} className="flex gap-3">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    step.type === 'user_input' ? 'bg-green-500/20 text-green-400' :
                    step.type === 'ai_response' ? 'bg-purple-500/20 text-purple-400' :
                    step.type === 'error' ? 'bg-red-500/20 text-red-400' :
                    step.type === 'result' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-white/10 text-white/50'
                  }`}>
                    {i + 1}
                  </div>
                  {i < conversation.length - 1 && (
                    <div className="w-px h-full bg-white/10 min-h-[20px]" />
                  )}
                </div>
                {/* Step content */}
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-white/70">{step.title}</span>
                    {step.model && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/40">
                        {step.model}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs p-2 rounded max-h-32 overflow-y-auto ${
                    step.type === 'ai_response' ? 'bg-purple-500/10 text-purple-200' :
                    step.type === 'error' ? 'bg-red-500/10 text-red-300' :
                    'bg-white/5 text-white/60'
                  }`}>
                    <pre className="whitespace-pre-wrap font-mono">{step.content}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Original request */}
      <div className="p-3 bg-white/5 rounded-lg border border-white/10">
        <p className="text-xs text-white/40 mb-1">Original Request</p>
        <p className="text-sm text-white/80">{input}</p>
      </div>
      
      {/* Jobs */}
      <div className="space-y-2">
        {jobStack.jobs.map((job, index) => (
          <JobCard
            key={job.job_id}
            job={job}
            index={index}
            expanded={expandedJob === job.job_id}
            onToggle={() => setExpandedJob(expandedJob === job.job_id ? null : job.job_id)}
            onUpdate={(updated) => updateJob(job.job_id, updated)}
            onDelete={() => deleteJob(job.job_id)}
          />
        ))}
      </div>
      
      {/* Add job button */}
      <button
        onClick={addJob}
        disabled={confirmed}
        className="w-full py-2 border border-dashed border-white/20 rounded-lg text-sm text-white/40 hover:text-white/60 hover:border-white/40 transition-colors disabled:opacity-30"
      >
        + Add Job
      </button>
      
      {/* Confirm button */}
      {confirmed ? (
        <div className="space-y-3">
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
            <p className="text-green-400 font-medium mb-1">✓ Jobs Confirmed</p>
            <p className="text-sm text-white/60">
              Switch back to the Electron app to execute
            </p>
          </div>
          <button
            onClick={() => setConfirmed(false)}
            className="w-full py-2 text-sm text-white/40 hover:text-white/60"
          >
            Edit Jobs
          </button>
        </div>
      ) : (
        <button
          onClick={sendToElectron}
          className="w-full py-3 rounded-lg font-medium transition-colors bg-green-500 text-white hover:bg-green-400"
        >
          Confirm Jobs ({jobStack.total_jobs})
        </button>
      )}
      
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
