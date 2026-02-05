"""
Job Interpreter API - converts plain text requests into structured JobStacks.

This is the core of "do A, do B, do C" → executable job specifications.
"""
import uuid
import json
import logging
import httpx
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from lightning_loop.backboard.client import backboard
from lightning_loop.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])


# ============================================================================
# Data Models
# ============================================================================

class ProjectContext(BaseModel):
    """Minimal project metadata for job interpretation."""
    project_path: Optional[str] = None
    language: Optional[str] = None
    framework: Optional[str] = None
    package_manager: Optional[str] = None
    description: Optional[str] = None


class JobSpec(BaseModel):
    """A single job specification - the unit of work for Ralph Loops."""
    job_id: str
    title: str
    objective: str
    scope_included: List[str] = Field(default_factory=list)
    scope_excluded: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    verification_commands: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)  # job_ids that must complete first
    estimated_iterations: int = Field(default=5, ge=1, le=50)
    status: str = Field(default="pending")  # pending, running, completed, failed, blocked
    
    # Execution tracking
    iterations_used: int = 0
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    stop_reason: Optional[str] = None
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)


class JobStack(BaseModel):
    """An ordered collection of jobs derived from a user request."""
    stack_id: str
    created_at: str
    user_request: str
    project_context: Optional[ProjectContext] = None
    jobs: List[JobSpec]
    execution_order: List[str]  # job_ids in execution order
    total_jobs: int
    completed_jobs: int = 0
    failed_jobs: int = 0
    status: str = "pending"  # pending, running, completed, failed, paused


class InterpretRequest(BaseModel):
    """Request to interpret a plain text user request into jobs."""
    user_request: str
    project_context: Optional[ProjectContext] = None
    verbosity: str = Field(default="medium", pattern="^(low|medium|high)$")
    model: Optional[str] = None  # Override model for this request
    thread_id: Optional[str] = None  # Thread with uploaded documents


class ConversationStep(BaseModel):
    """A single step in the AI conversation for transparency."""
    step_id: str
    type: str  # 'user_input', 'system_prompt', 'ai_response', 'parsing'
    title: str
    content: str
    timestamp: str
    model: Optional[str] = None
    tokens: Optional[int] = None


class InterpretResponse(BaseModel):
    """Response containing the generated JobStack."""
    stack_id: str
    jobs: List[JobSpec]
    execution_order: List[str]
    total_jobs: int
    # Transparency: show the full conversation
    conversation: List[ConversationStep] = Field(default_factory=list)


class ExecuteRequest(BaseModel):
    """Request to execute a job stack."""
    job_stack: Dict[str, Any]  # The full job stack


class ExecuteResponse(BaseModel):
    """Response from job execution."""
    status: str
    message: str
    jobs_completed: int = 0
    jobs_failed: int = 0


# ============================================================================
# Job Interpretation Prompt
# ============================================================================

JOB_INTERPRETER_PROMPT = """You are a job interpreter for a code automation system called Invene.

Given a user's plain text request describing changes to an existing app, decompose it into discrete, actionable jobs.

User Request: {user_request}

Project Context:
{project_context}

Verbosity: {verbosity}
- low: 3-5 jobs, high-level only
- medium: 5-10 jobs, balanced detail
- high: 10-15 jobs, fine-grained subtasks

For each job, provide:
1. title: Short name (e.g., "Add OAuth Provider")
2. objective: Specific deliverable (e.g., "Implement Google OAuth login flow with session management")
3. scope_included: What's explicitly in scope
4. scope_excluded: What's explicitly NOT in scope
5. constraints: Technical/business constraints (e.g., "Use existing user table", "Keep changes minimal")
6. success_criteria: Pass/fail conditions (e.g., "User can log in via Google", "Session persists across page refresh")
7. verification_commands: Commands to verify success (e.g., "npm test", "curl localhost:3000/auth/google")
8. dependencies: Which jobs must complete first (by title reference)
9. estimated_iterations: Expected Ralph loop iterations (1-10 typical)

IMPORTANT:
- Jobs should be domain-specific, not generic. If building a "dog dating app", jobs should mention dogs, profiles, swipes, matches.
- Each job must be independently testable.
- Order jobs by dependency (earlier jobs are prerequisites for later ones).
- Include setup/scaffolding jobs before feature jobs.

Output valid JSON:
{{
  "jobs": [
    {{
      "title": "...",
      "objective": "...",
      "scope_included": ["..."],
      "scope_excluded": ["..."],
      "constraints": ["..."],
      "success_criteria": ["..."],
      "verification_commands": ["..."],
      "dependencies": [],
      "estimated_iterations": 5
    }}
  ]
}}
"""


# ============================================================================
# Routes
# ============================================================================

@router.post("/interpret", response_model=InterpretResponse)
async def interpret_request(request: InterpretRequest):
    """
    Convert a plain text user request into a structured JobStack.
    
    Example input: "Add OAuth, build landing page, add local DB"
    Output: JobStack with 6-12 structured job specifications
    """
    logger.info(f"[JobInterpreter] Interpreting request: {request.user_request[:50]}...")
    
    # Conversation trace for transparency
    conversation: List[ConversationStep] = []
    step_counter = 0
    
    def add_step(step_type: str, title: str, content: str, model: str = None, tokens: int = None):
        nonlocal step_counter
        step_counter += 1
        conversation.append(ConversationStep(
            step_id=f"step-{step_counter:03d}",
            type=step_type,
            title=title,
            content=content,
            timestamp=datetime.now().isoformat(),
            model=model,
            tokens=tokens,
        ))
    
    # Step 1: User input
    add_step("user_input", "Your Request", request.user_request)
    
    # Build project context string
    ctx = request.project_context
    if ctx:
        project_context_str = f"""
- Path: {ctx.project_path or 'Not specified'}
- Language: {ctx.language or 'Auto-detect'}
- Framework: {ctx.framework or 'Auto-detect'}
- Package Manager: {ctx.package_manager or 'Auto-detect'}
- Description: {ctx.description or 'Not provided'}
"""
    else:
        project_context_str = "No project context provided. Assume typical web application."
    
    # Build the prompt
    prompt = JOB_INTERPRETER_PROMPT.format(
        user_request=request.user_request,
        project_context=project_context_str,
        verbosity=request.verbosity,
    )
    
    # Step 2: System prompt
    system_prompt = "You are a precise job decomposition engine. Output only valid JSON."
    add_step("system_prompt", "System Instructions", system_prompt)
    
    # Step 3: Full prompt sent to AI
    add_step("prompt", "Prompt to AI", prompt[:2000] + ("..." if len(prompt) > 2000 else ""))
    
    response = None
    used_model = request.model or "default"
    
    try:
        # Call Backboard for interpretation
        logger.info("[JobInterpreter] Calling Backboard LLM...")
        logger.info(f"[JobInterpreter] Using model: {used_model}")
        response = await backboard.one_shot(
            prompt=prompt,
            system_prompt=system_prompt,
            model=request.model,
        )
        
        logger.info(f"[JobInterpreter] Got response: {response[:200]}...")
        
        # Step 4: AI response
        add_step("ai_response", "AI Response", response, model=used_model)
        
        # Parse the JSON response
        jobs_data = _parse_jobs_json(response)
        
        # Step 5: Parsing result
        add_step("parsing", "Parsed Jobs", f"Successfully parsed {len(jobs_data)} jobs from AI response")
        
    except Exception as e:
        logger.warning(f"[JobInterpreter] Backboard failed: {e}, using fallback")
        
        # Step 4b: Error
        add_step("error", "AI Error", f"Backboard call failed: {str(e)}")
        
        jobs_data = _fallback_job_interpretation(request.user_request, request.verbosity)
        
        # Step 5b: Fallback
        add_step("fallback", "Fallback Parser", f"Used regex fallback to extract {len(jobs_data)} jobs")
    
    # Generate stack
    stack_id = str(uuid.uuid4())
    jobs = []
    execution_order = []
    
    # Map titles to job_ids for dependency resolution
    title_to_id = {}
    
    for i, job_data in enumerate(jobs_data):
        job_id = f"job-{i+1:03d}"
        title_to_id[job_data.get("title", f"Job {i+1}")] = job_id
        
        job = JobSpec(
            job_id=job_id,
            title=job_data.get("title", f"Job {i+1}"),
            objective=job_data.get("objective", ""),
            scope_included=job_data.get("scope_included", []),
            scope_excluded=job_data.get("scope_excluded", []),
            constraints=job_data.get("constraints", []),
            success_criteria=job_data.get("success_criteria", []),
            verification_commands=job_data.get("verification_commands", []),
            dependencies=[],  # Will resolve below
            estimated_iterations=job_data.get("estimated_iterations", 5),
        )
        jobs.append(job)
        execution_order.append(job_id)
    
    # Resolve dependencies by title to job_id
    for i, job_data in enumerate(jobs_data):
        dep_titles = job_data.get("dependencies", [])
        jobs[i].dependencies = [
            title_to_id[t] for t in dep_titles if t in title_to_id
        ]
    
    logger.info(f"[JobInterpreter] Created {len(jobs)} jobs")
    
    # Step 6: Final result
    add_step("result", "Job Stack Created", f"Created stack {stack_id} with {len(jobs)} jobs")
    
    return InterpretResponse(
        stack_id=stack_id,
        jobs=jobs,
        execution_order=execution_order,
        total_jobs=len(jobs),
        conversation=conversation,
    )


@router.get("/stack/{stack_id}")
async def get_job_stack(stack_id: str):
    """Get a job stack by ID. (TODO: Add persistence)"""
    # For now, return 404 - we'll add persistence later
    raise HTTPException(status_code=404, detail="Job stack not found")


@router.post("/stack/{stack_id}/start")
async def start_job_stack(stack_id: str):
    """Start executing a job stack. (TODO: Implement)"""
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.post("/execute", response_model=ExecuteResponse)
async def execute_jobs(request: ExecuteRequest):
    """
    Execute a job stack by running Ralph loops for each job.
    
    For now, this is a placeholder that logs execution intent.
    Real execution happens via Electron's Ralph runner which can
    physically interact with the IDE.
    """
    import subprocess
    import os
    
    job_stack = request.job_stack
    jobs = job_stack.get("jobs", [])
    
    logger.info(f"[Execute] Starting execution of {len(jobs)} jobs")
    
    jobs_completed = 0
    jobs_failed = 0
    
    # Get the Ralph path
    project_root = os.environ.get("PROJECT_ROOT", "/Users/lucas/Desktop/copilot^squared")
    ralph_script = os.path.join(project_root, "ralph", "run_job.py")
    
    # Check if ralph script exists
    if not os.path.exists(ralph_script):
        logger.error(f"[Execute] Ralph script not found: {ralph_script}")
        return ExecuteResponse(
            status="failed",
            message=f"Ralph script not found at {ralph_script}",
            jobs_completed=0,
            jobs_failed=len(jobs),
        )
    
    for job in jobs:
        job_title = job.get("title", "Unknown")
        logger.info(f"[Execute] Running job: {job_title}")
        
        try:
            # Pass job as JSON to the Ralph script
            job_json = json.dumps(job)
            
            # Set up environment with PYTHONPATH
            env = os.environ.copy()
            env["PYTHONPATH"] = os.path.join(project_root, "ralph")
            
            # Run Ralph loop via subprocess
            result = subprocess.run(
                ["/usr/bin/python3", ralph_script, job_json],
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout per job
                cwd=project_root,
                env=env,
            )
            
            logger.info(f"[Execute] stdout: {result.stdout[:500] if result.stdout else 'empty'}")
            logger.info(f"[Execute] stderr: {result.stderr[:500] if result.stderr else 'empty'}")
            
            if result.returncode == 0:
                jobs_completed += 1
                logger.info(f"[Execute] Job completed: {job_title}")
            else:
                jobs_failed += 1
                logger.warning(f"[Execute] Job failed: {job_title} - exit code {result.returncode}")
                logger.warning(f"[Execute] stderr: {result.stderr[:500] if result.stderr else 'empty'}")
                
        except subprocess.TimeoutExpired:
            jobs_failed += 1
            logger.warning(f"[Execute] Job timed out: {job_title}")
        except Exception as e:
            jobs_failed += 1
            logger.error(f"[Execute] Job error: {job_title} - {e}")
    
    return ExecuteResponse(
        status="completed" if jobs_failed == 0 else "partial",
        message=f"Completed {jobs_completed}/{len(jobs)} jobs",
        jobs_completed=jobs_completed,
        jobs_failed=jobs_failed,
    )


# ============================================================================
# Helpers
# ============================================================================

def _parse_jobs_json(response: str) -> List[Dict[str, Any]]:
    """Parse LLM response to extract jobs JSON."""
    # Try to find JSON in the response
    response = response.strip()
    
    # Handle markdown code blocks
    if "```json" in response:
        start = response.find("```json") + 7
        end = response.find("```", start)
        response = response[start:end].strip()
    elif "```" in response:
        start = response.find("```") + 3
        end = response.find("```", start)
        response = response[start:end].strip()
    
    try:
        data = json.loads(response)
        if isinstance(data, dict) and "jobs" in data:
            return data["jobs"]
        elif isinstance(data, list):
            return data
        else:
            logger.warning(f"[JobInterpreter] Unexpected JSON structure: {type(data)}")
            return []
    except json.JSONDecodeError as e:
        logger.error(f"[JobInterpreter] JSON parse error: {e}")
        logger.error(f"[JobInterpreter] Raw response: {response[:500]}")
        return []


def _fallback_job_interpretation(user_request: str, verbosity: str) -> List[Dict[str, Any]]:
    """
    Fallback heuristic when LLM is unavailable.
    Splits request by common delimiters and creates basic jobs.
    """
    # Split by common delimiters
    delimiters = [", ", ". ", " and ", " then ", "\n"]
    tasks = [user_request]
    
    for delim in delimiters:
        new_tasks = []
        for task in tasks:
            new_tasks.extend(task.split(delim))
        tasks = new_tasks
    
    # Clean up
    tasks = [t.strip() for t in tasks if t.strip() and len(t.strip()) > 3]
    
    # Remove duplicates while preserving order
    seen = set()
    unique_tasks = []
    for t in tasks:
        t_lower = t.lower()
        if t_lower not in seen:
            seen.add(t_lower)
            unique_tasks.append(t)
    
    # Limit based on verbosity
    max_jobs = {"low": 5, "medium": 10, "high": 15}.get(verbosity, 10)
    unique_tasks = unique_tasks[:max_jobs]
    
    jobs = []
    for i, task in enumerate(unique_tasks):
        # Clean up the task description
        task = task.strip(".,;:")
        if task.lower().startswith(("add ", "create ", "build ", "implement ", "setup ", "configure ")):
            title = task
        else:
            title = f"Implement: {task}"
        
        jobs.append({
            "title": title[:50],  # Limit title length
            "objective": f"Complete the following task: {task}",
            "scope_included": [task],
            "scope_excluded": [],
            "constraints": ["Keep changes minimal", "Follow existing code patterns"],
            "success_criteria": [f"Task '{task}' is complete and functional"],
            "verification_commands": [],
            "dependencies": [jobs[i-1]["title"]] if i > 0 else [],
            "estimated_iterations": 5,
        })
    
    return jobs


# ============================================================================
# Confirmed Jobs Storage (in-memory for now)
# ============================================================================

_confirmed_jobs_store: Dict[str, Any] = {}


class ConfirmJobsRequest(BaseModel):
    """Request to confirm a job stack for execution."""
    job_stack: Dict[str, Any]


@router.post("/confirm")
async def confirm_jobs(request: ConfirmJobsRequest):
    """
    Store confirmed jobs for pickup by Electron app.
    Website calls this after user edits and confirms jobs.
    """
    global _confirmed_jobs_store
    
    job_stack = request.job_stack
    job_stack["confirmed_at"] = datetime.now().isoformat()
    
    # Store with a simple key - only one pending confirmation at a time
    _confirmed_jobs_store["latest"] = job_stack
    
    logger.info(f"[Confirm] Stored {len(job_stack.get('jobs', []))} confirmed jobs")
    
    return {"status": "confirmed", "jobs_count": len(job_stack.get("jobs", []))}


@router.get("/confirmed")
async def get_confirmed_jobs():
    """
    Get confirmed jobs (called by Electron to pick them up).
    Returns and clears the confirmed jobs.
    """
    global _confirmed_jobs_store
    
    if "latest" not in _confirmed_jobs_store:
        return {"has_jobs": False}
    
    jobs = _confirmed_jobs_store.pop("latest")
    logger.info(f"[Confirm] Electron picked up {len(jobs.get('jobs', []))} jobs")
    
    return {"has_jobs": True, "job_stack": jobs}


# ============================================================================
# Models API
# ============================================================================

# Cache for models (refresh every hour)
_models_cache: Dict[str, Any] = {"models": [], "fetched_at": None}

# Fallback models if API fails
FALLBACK_MODELS = [
    {"id": "anthropic/claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "provider": "anthropic"},
    {"id": "anthropic/claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet", "provider": "anthropic"},
    {"id": "openai/gpt-4o", "name": "GPT-4o", "provider": "openai"},
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "provider": "openai"},
    {"id": "google/gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "google"},
    {"id": "amazon/nova-micro-v1", "name": "Nova Micro", "provider": "amazon"},
]


@router.get("/models")
async def get_models():
    """Get available models from Backboard API."""
    global _models_cache
    
    # Check cache (1 hour TTL)
    if _models_cache["fetched_at"]:
        age = (datetime.now() - datetime.fromisoformat(_models_cache["fetched_at"])).seconds
        if age < 3600 and _models_cache["models"]:
            return {"models": _models_cache["models"], "source": "cache"}
    
    # Fetch from Backboard
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.backboard_base_url}/models",
                headers={"X-API-Key": settings.backboard_api_key},
                params={"model_type": "llm", "limit": 50}
            )
            
            if resp.status_code == 200:
                data = resp.json()
                raw_models = data.get("models", [])
                
                # Transform to our format
                models = []
                for m in raw_models:
                    models.append({
                        "id": f"{m['provider']}/{m['name']}",
                        "name": m["name"],
                        "provider": m["provider"],
                        "context_limit": m.get("context_limit"),
                        "supports_tools": m.get("supports_tools", False),
                    })
                
                # Update cache
                _models_cache = {
                    "models": models,
                    "fetched_at": datetime.now().isoformat()
                }
                
                logger.info(f"[Models] Fetched {len(models)} models from Backboard")
                return {"models": models, "source": "backboard"}
                
    except Exception as e:
        logger.warning(f"[Models] Failed to fetch from Backboard: {e}")
    
    # Fallback to hardcoded list
    return {"models": FALLBACK_MODELS, "source": "fallback"}


# ============================================================================
# Document Upload API
# ============================================================================

# Store thread IDs with uploaded documents
_document_threads: Dict[str, str] = {}


@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a document for context. Creates a thread and attaches the document.
    Returns thread_id to be used with interpret endpoint.
    """
    logger.info(f"[Documents] Uploading file: {file.filename}")
    
    if not settings.backboard_api_key:
        raise HTTPException(status_code=500, detail="Backboard API not configured")
    
    headers = {
        "X-API-Key": settings.backboard_api_key,
    }
    
    try:
        # First create an assistant
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.backboard_base_url}/assistants",
                headers={**headers, "Content-Type": "application/json"},
                json={"name": "Document Context Assistant", "system_prompt": "You help interpret project requirements."}
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=500, detail=f"Failed to create assistant: {resp.text}")
            assistant_id = resp.json().get("assistant_id") or resp.json().get("id")
        
        # Create a thread
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.backboard_base_url}/assistants/{assistant_id}/threads",
                headers={**headers, "Content-Type": "application/json"},
                json={}
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=500, detail=f"Failed to create thread: {resp.text}")
            thread_id = resp.json().get("thread_id") or resp.json().get("id")
        
        # Upload document to thread
        file_content = await file.read()
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{settings.backboard_base_url}/threads/{thread_id}/documents",
                headers=headers,
                files={"file": (file.filename, file_content, file.content_type or "application/octet-stream")}
            )
            if resp.status_code not in (200, 201):
                logger.error(f"[Documents] Upload failed: {resp.text}")
                raise HTTPException(status_code=500, detail=f"Failed to upload document: {resp.text}")
        
        logger.info(f"[Documents] Uploaded {file.filename} to thread {thread_id}")
        
        return {
            "thread_id": thread_id,
            "filename": file.filename,
            "status": "uploaded"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Documents] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
