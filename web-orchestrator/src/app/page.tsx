'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { JobStackView } from '@/components/JobStackView';

// Dynamically import GL to avoid SSR issues with Three.js
const GL = dynamic(() => import('@/components/gl'), { ssr: false });

function HomeContent() {
  const [hovering, setHovering] = useState(false);
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get('prompt') || '';
  
  return (
    <main className="h-screen flex overflow-hidden bg-black relative">
      {/* WebGL Background Animation */}
      <GL hovering={hovering} />
      
      {/* Centered Content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div 
          className="w-full max-w-2xl mx-auto p-8"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-4 mb-4">
              <img src="/logo.webp" alt="invene" className="w-12 h-12 rounded-xl" />
              <h1 className="text-4xl font-light text-white tracking-wide">invene</h1>
            </div>
            <p className="text-white/40">
              Describe what you want to build. We&apos;ll break it down and execute it.
            </p>
          </div>
          
          {/* Job Stack Interface */}
          <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 p-6">
            <JobStackView initialPrompt={initialPrompt} />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="h-screen flex items-center justify-center bg-black">
        <div className="text-white/40">Loading...</div>
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}
