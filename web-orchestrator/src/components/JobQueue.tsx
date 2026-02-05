'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock, Play } from 'lucide-react';

interface Job {
  job_id: string;
  graph_id: string;
  status: string;
  current_node_id?: string;
  current_node_index?: number;
  created_at: string;
  claimed_by?: string;
  user_request?: string;
  total_nodes?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8811/api';

export function JobQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    console.log('[DEBUG] JobQueue: Fetching jobs list...');
    try {
      const response = await fetch(`${API_BASE}/relay/jobs/list?limit=20`);
      
      console.log('[DEBUG] JobQueue: Response status', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('[DEBUG] JobQueue: Got jobs', data);
        setJobs(Array.isArray(data) ? data : []);
      } else {
        setJobs([]);
      }
    } catch (e) {
      console.error('[DEBUG] JobQueue: Error fetching jobs', e);
      setError('Failed to fetch jobs');
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-400" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Clock className="w-4 h-4 text-white/40" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500/10 border-yellow-500/30';
      case 'running':
        return 'bg-blue-500/10 border-blue-500/30';
      case 'completed':
        return 'bg-green-500/10 border-green-500/30';
      case 'failed':
        return 'bg-red-500/10 border-red-500/30';
      default:
        return 'bg-white/5 border-white/10';
    }
  };

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/80">Job Queue</h3>
        <span className="text-xs text-white/40">{jobs.length} job(s)</span>
      </div>
      
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.job_id}
            className={`p-3 rounded-lg border ${getStatusColor(job.status)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {getStatusIcon(job.status)}
                <span className="text-xs font-medium text-white/80 capitalize">
                  {job.status}
                </span>
              </div>
              <span className="text-[10px] text-white/40">
                {job.job_id.slice(0, 8)}...
              </span>
            </div>
            
            {job.current_node_index !== undefined && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500/50 rounded-full transition-all"
                    style={{ width: `${job.total_nodes ? ((job.current_node_index || 0) / Math.max(job.total_nodes, 1)) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/40">
                  Node {job.current_node_index || 0}{job.total_nodes ? ` / ${job.total_nodes}` : ''}
                </span>
              </div>
            )}
            
            <div className="text-[10px] text-white/30 mt-2 space-y-1">
              {job.user_request && <div className="truncate">{job.user_request}</div>}
              <div>Created: {new Date(job.created_at).toLocaleTimeString()}</div>
              {job.claimed_by && <div>Claimed by: {job.claimed_by}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
