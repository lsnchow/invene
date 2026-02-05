"""
Graph Builder API - generates TaskGraph from user request + docs + sliders via LLM.
"""
import uuid
import json
import logging
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any, AsyncGenerator
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from lightning_loop.backboard.client import backboard

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/graph", tags=["graph"])


# ============================================================================
# Request/Response Models
# ============================================================================

class SliderPreset(BaseModel):
    verbosity: str = Field(default="medium", pattern="^(low|medium|high)$")
    autonomy: str = Field(default="medium", pattern="^(low|medium|high)$")
    risk_tolerance: str = Field(default="safe", pattern="^(safe|aggressive)$")


class DocumentInput(BaseModel):
    doc_id: str
    filename: str
    extracted_summary: Optional[str] = None
    chunk_refs: Optional[List[str]] = None


class GenerateGraphRequest(BaseModel):
    user_request: str
    documents: List[DocumentInput] = Field(default_factory=list)
    slider_preset: SliderPreset = Field(default_factory=SliderPreset)


class TaskNode(BaseModel):
    node_id: str
    title: str
    node_type: str
    objective: str
    constraints: Optional[List[str]] = None
    success_checks: Optional[List[str]] = None
    doc_refs: Optional[List[str]] = None
    dependencies: List[str] = Field(default_factory=list)
    ralph_profile: Optional[str] = None


class TaskEdge(BaseModel):
    from_node_id: str
    to_node_id: str
    edge_type: str = "depends_on"


class GenerateGraphResponse(BaseModel):
    graph_id: str
    created_at: str
    user_request: str
    slider_preset: SliderPreset
    inputs: Dict[str, Any]
    nodes: List[TaskNode]
    edges: List[TaskEdge]


# ============================================================================
# Graph Generation Logic
# ============================================================================

GRAPH_BUILDER_PROMPT = """You are a task graph builder. Given a user request and optional document summaries, 
decompose the work into a directed acyclic graph of tasks.

User Request: {user_request}

{documents_section}

Slider Settings:
- Verbosity: {verbosity} (low = 3-6 nodes, medium = 6-12 nodes, high = 12-25 detailed subtasks)
- Autonomy: {autonomy} (low = add "Clarify X" nodes for unknowns, high = embed assumptions in constraints)
- Risk Tolerance: {risk_tolerance} (safe = add validation nodes, aggressive = fewer checks)

Generate a TaskGraph JSON with the following structure:
{{
  "nodes": [
    {{
      "node_id": "unique-id",
      "title": "Short descriptive title",
      "node_type": "planning|execution|validation|doc_index|memory|output",
      "objective": "What this task accomplishes",
      "constraints": ["explicit constraint 1", "..."],
      "success_checks": ["how to verify success"],
      "doc_refs": ["doc-id if uses document"],
      "dependencies": ["node-id of tasks that must complete first"]
    }}
  ],
  "edges": [
    {{
      "from_node_id": "source-node",
      "to_node_id": "target-node",
      "edge_type": "depends_on|uses_doc|produces_artifact"
    }}
  ]
}}

Node types:
- planning: Analysis, design, or decomposition work
- execution: Actual implementation work (code, config, etc.)
- validation: Testing, verification, or quality checks
- doc_index: Processing uploaded documents
- memory: Storing or recalling context
- output: Final deliverables

Rules:
1. Always create a "doc_index" node first if documents are provided
2. Execution nodes should depend on relevant planning nodes
3. Add validation nodes after execution if risk_tolerance is "safe"
4. If autonomy is "low", add "Clarify: X" planning nodes for ambiguous requirements
5. Match verbosity setting for node count
6. Each node should have clear, actionable objectives
7. Dependencies must form a DAG (no cycles)

Return ONLY the JSON object, no other text."""


def build_documents_section(documents: List[DocumentInput]) -> str:
    if not documents:
        return "Documents: None provided"
    
    lines = ["Documents:"]
    for doc in documents:
        lines.append(f"- {doc.filename} (ID: {doc.doc_id})")
        if doc.extracted_summary:
            lines.append(f"  Summary: {doc.extracted_summary}")
    return "\n".join(lines)


async def generate_task_graph(
    user_request: str,
    documents: List[DocumentInput],
    sliders: SliderPreset,
) -> Dict[str, Any]:
    """Generate a TaskGraph using the LLM."""
    
    prompt = GRAPH_BUILDER_PROMPT.format(
        user_request=user_request,
        documents_section=build_documents_section(documents),
        verbosity=sliders.verbosity,
        autonomy=sliders.autonomy,
        risk_tolerance=sliders.risk_tolerance,
    )
    
    try:
        # Use backboard for LLM call (one_shot for stateless generation)
        response = await backboard.one_shot(
            prompt=prompt,
            system_prompt="You are a precise JSON generator. Output only valid JSON, no markdown code fences.",
        )
        
        # Parse JSON from response
        # Try to extract JSON from the response
        response_text = response.strip()
        
        # Handle potential markdown code blocks
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = []
            in_json = False
            for line in lines:
                if line.startswith("```json"):
                    in_json = True
                    continue
                elif line.startswith("```"):
                    in_json = False
                    continue
                if in_json:
                    json_lines.append(line)
            response_text = "\n".join(json_lines)
        
        graph_data = json.loads(response_text)
        return graph_data
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse graph JSON: {e}")
        logger.error(f"Response was: {response[:500] if response else 'empty'}")
        raise HTTPException(status_code=500, detail="Failed to parse generated graph")
    except Exception as e:
        logger.error(f"Graph generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def generate_fallback_graph(
    user_request: str,
    documents: List[DocumentInput],
    sliders: SliderPreset,
) -> Dict[str, Any]:
    """Generate a simple fallback graph without LLM."""
    
    nodes = []
    edges = []
    
    # Determine node count based on verbosity
    base_count = {"low": 4, "medium": 8, "high": 15}[sliders.verbosity]
    
    # Document index node if docs present
    if documents:
        nodes.append({
            "node_id": "doc-index",
            "title": "Index Documents",
            "node_type": "doc_index",
            "objective": "Extract and index information from uploaded documents",
            "constraints": [],
            "success_checks": ["All documents processed", "Key information extracted"],
            "doc_refs": [d.doc_id for d in documents],
            "dependencies": [],
        })
    
    # Planning node
    planning_deps = ["doc-index"] if documents else []
    nodes.append({
        "node_id": "plan-main",
        "title": "Analyze Requirements",
        "node_type": "planning",
        "objective": f"Break down the request: {user_request[:100]}",
        "constraints": [],
        "success_checks": ["Clear implementation plan created"],
        "doc_refs": [],
        "dependencies": planning_deps,
    })
    
    # Add clarification node if low autonomy
    if sliders.autonomy == "low":
        nodes.append({
            "node_id": "clarify",
            "title": "Clarify Ambiguities",
            "node_type": "planning",
            "objective": "Identify and resolve unclear requirements",
            "constraints": [],
            "success_checks": ["All ambiguities documented"],
            "doc_refs": [],
            "dependencies": ["plan-main"],
        })
        edges.append({
            "from_node_id": "plan-main",
            "to_node_id": "clarify",
            "edge_type": "depends_on",
        })
    
    # Main execution node
    exec_deps = ["clarify"] if sliders.autonomy == "low" else ["plan-main"]
    nodes.append({
        "node_id": "exec-main",
        "title": "Execute Main Task",
        "node_type": "execution",
        "objective": user_request,
        "constraints": [],
        "success_checks": ["Core functionality implemented"],
        "doc_refs": [],
        "dependencies": exec_deps,
    })
    
    # Validation node if safe mode
    if sliders.risk_tolerance == "safe":
        nodes.append({
            "node_id": "validate",
            "title": "Validate Results",
            "node_type": "validation",
            "objective": "Verify implementation meets requirements",
            "constraints": [],
            "success_checks": ["All tests pass", "No critical issues"],
            "doc_refs": [],
            "dependencies": ["exec-main"],
        })
    
    # Output node
    output_deps = ["validate"] if sliders.risk_tolerance == "safe" else ["exec-main"]
    nodes.append({
        "node_id": "output",
        "title": "Deliver Results",
        "node_type": "output",
        "objective": "Package and deliver the completed work",
        "constraints": [],
        "success_checks": ["Deliverables ready"],
        "doc_refs": [],
        "dependencies": output_deps,
    })
    
    # Build edges from dependencies
    for node in nodes:
        for dep in node.get("dependencies", []):
            edges.append({
                "from_node_id": dep,
                "to_node_id": node["node_id"],
                "edge_type": "depends_on",
            })
    
    return {"nodes": nodes, "edges": edges}


# ============================================================================
# Routes
# ============================================================================

@router.post("/generate", response_model=GenerateGraphResponse)
async def generate_graph(request: GenerateGraphRequest):
    """
    Generate a TaskGraph from a user request.
    Uses LLM to decompose the request into a structured graph.
    """
    graph_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    try:
        # Try LLM generation first
        graph_data = await generate_task_graph(
            request.user_request,
            request.documents,
            request.slider_preset,
        )
    except Exception as e:
        logger.warning(f"LLM graph generation failed, using fallback: {e}")
        # Fall back to simple rule-based generation
        graph_data = generate_fallback_graph(
            request.user_request,
            request.documents,
            request.slider_preset,
        )
    
    # Transform nodes to include node_id if missing
    nodes = []
    for i, node in enumerate(graph_data.get("nodes", [])):
        nodes.append(TaskNode(
            node_id=node.get("node_id", f"node-{i}"),
            title=node.get("title", f"Task {i+1}"),
            node_type=node.get("node_type", "execution"),
            objective=node.get("objective", ""),
            constraints=node.get("constraints"),
            success_checks=node.get("success_checks"),
            doc_refs=node.get("doc_refs"),
            dependencies=node.get("dependencies", []),
            ralph_profile=node.get("ralph_profile"),
        ))
    
    edges = [
        TaskEdge(**edge) for edge in graph_data.get("edges", [])
    ]
    
    logger.info(f"Generated graph {graph_id} with {len(nodes)} nodes")
    
    return GenerateGraphResponse(
        graph_id=graph_id,
        created_at=created_at,
        user_request=request.user_request,
        slider_preset=request.slider_preset,
        inputs={
            "documents": [d.model_dump() for d in request.documents],
        },
        nodes=nodes,
        edges=edges,
    )


@router.post("/generate/stream")
async def generate_graph_stream(request: GenerateGraphRequest):
    """
    Generate a TaskGraph with streaming - nodes appear one by one.
    Returns Server-Sent Events as nodes are generated.
    """
    graph_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    async def event_stream() -> AsyncGenerator[str, None]:
        # Send initial event with graph metadata
        yield f"data: {json.dumps({'type': 'start', 'graph_id': graph_id, 'created_at': created_at})}\n\n"
        
        try:
            # Try LLM generation first
            graph_data = await generate_task_graph(
                request.user_request,
                request.documents,
                request.slider_preset,
            )
        except Exception as e:
            logger.warning(f"LLM graph generation failed, using fallback: {e}")
            graph_data = generate_fallback_graph(
                request.user_request,
                request.documents,
                request.slider_preset,
            )
        
        nodes = graph_data.get("nodes", [])
        edges = graph_data.get("edges", [])
        
        # Stream nodes one by one with delay for visual effect
        for i, node in enumerate(nodes):
            node_data = {
                "node_id": node.get("node_id", f"node-{i}"),
                "title": node.get("title", f"Task {i+1}"),
                "node_type": node.get("node_type", "execution"),
                "objective": node.get("objective", ""),
                "constraints": node.get("constraints"),
                "success_checks": node.get("success_checks"),
                "doc_refs": node.get("doc_refs"),
                "dependencies": node.get("dependencies", []),
                "ralph_profile": node.get("ralph_profile"),
            }
            
            yield f"data: {json.dumps({'type': 'node', 'node': node_data, 'index': i, 'total': len(nodes)})}\n\n"
            
            # Small delay between nodes for visual effect
            await asyncio.sleep(0.15)
        
        # Stream edges
        for edge in edges:
            yield f"data: {json.dumps({'type': 'edge', 'edge': edge})}\n\n"
            await asyncio.sleep(0.05)
        
        # Send completion event
        yield f"data: {json.dumps({'type': 'complete', 'graph_id': graph_id, 'node_count': len(nodes), 'edge_count': len(edges)})}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
