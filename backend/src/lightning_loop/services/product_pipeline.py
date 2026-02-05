"""Product Design Pipeline - 10-stage autonomous PRD generation."""
from dataclasses import dataclass, field
from typing import Optional, AsyncGenerator
from enum import Enum
import json
import logging

from lightning_loop.backboard.client import backboard

# Set up logging
logger = logging.getLogger(__name__)


class ProductStage(str, Enum):
    IDEA_GROUNDING = "idea_grounding"
    PROBLEM_DEFINITION = "problem_definition"
    USER_FRAMING = "user_framing"
    SOLUTION_SHAPING = "solution_shaping"
    FEATURE_DECOMPOSITION = "feature_decomposition"
    SYSTEM_DESIGN = "system_design"
    RISK_ANALYSIS = "risk_analysis"
    MVP_DEFINITION = "mvp_definition"
    MILESTONE_PLANNING = "milestone_planning"
    PRD_ASSEMBLY = "prd_assembly"


STAGE_ORDER = list(ProductStage)

STAGE_SUMMARIES = {
    ProductStage.IDEA_GROUNDING: "Grounding your product idea",
    ProductStage.PROBLEM_DEFINITION: "Defining the core problem",
    ProductStage.USER_FRAMING: "Identifying target users",
    ProductStage.SOLUTION_SHAPING: "Shaping the solution approach",
    ProductStage.FEATURE_DECOMPOSITION: "Breaking down features",
    ProductStage.SYSTEM_DESIGN: "Designing system architecture",
    ProductStage.RISK_ANALYSIS: "Analyzing risks and constraints",
    ProductStage.MVP_DEFINITION: "Scoping the MVP",
    ProductStage.MILESTONE_PLANNING: "Planning milestones",
    ProductStage.PRD_ASSEMBLY: "Assembling final PRD",
}


@dataclass
class ProductState:
    """Accumulated state across pipeline stages."""
    user_input: str
    version: int = 1
    session_key: str = ""
    
    # Stage outputs
    product_concept: Optional[dict] = None
    problem_definition: Optional[dict] = None
    user_model: Optional[dict] = None
    solution_frame: Optional[dict] = None
    feature_set: Optional[dict] = None
    system_design: Optional[dict] = None
    risk_profile: Optional[dict] = None
    mvp_scope: Optional[dict] = None
    delivery_plan: Optional[dict] = None
    prd_final: Optional[str] = None
    
    # Revision context
    revision_request: Optional[str] = None
    prior_versions: list = field(default_factory=list)


STAGE_PROMPTS = {
    ProductStage.IDEA_GROUNDING: """You are a product strategist. Given a vague product idea, ground it into a concrete concept.

USER INPUT: {user_input}

Output JSON with:
- product_name: A working name for the product
- value_proposition: One sentence describing the core value
- primary_outcome: What success looks like for users

Be concise. No fluff. Ground the idea in reality.""",

    ProductStage.PROBLEM_DEFINITION: """You are a product analyst. Define the real problem this product solves.

PRODUCT CONCEPT: {product_concept}
USER INPUT: {user_input}

Output JSON with:
- problem_statement: The core problem in one paragraph
- pain_points: List of 3-5 specific pain points
- existing_solutions_fail: Why current solutions don't work
- success_definition: How we know the problem is solved

Reject novelty-only ideas. Focus on real pain.""",

    ProductStage.USER_FRAMING: """You are a user researcher. Define who will use this product.

PRODUCT CONCEPT: {product_concept}
PROBLEM: {problem_definition}

Output JSON with:
- primary_user: Object with name, description, goals
- secondary_users: List of other user types
- usage_context: When and where they use it
- core_jobs: 3-5 jobs-to-be-done
- assumptions: Key assumptions about users

Be specific. Avoid generic personas.""",

    ProductStage.SOLUTION_SHAPING: """You are a product designer. Define the solution approach WITHOUT listing features yet.

PRODUCT CONCEPT: {product_concept}
PROBLEM: {problem_definition}
USERS: {user_model}

Output JSON with:
- product_vision: 2-3 sentence vision statement
- solution_category: Type of product (web app, mobile, API, etc.)
- design_principles: 3-5 guiding principles
- non_goals: Things this product explicitly will NOT do

Keep it strategic, not tactical.""",

    ProductStage.FEATURE_DECOMPOSITION: """You are a product manager. Convert the solution into concrete features.

SOLUTION: {solution_frame}
USERS: {user_model}
PROBLEM: {problem_definition}

Output JSON with:
- core_features: List of must-have features with name and description
- user_journeys: 2-3 primary user flows
- nice_to_have: Features that can wait
- deferred: Features explicitly out of scope for now

Avoid overbuilding. Less is more.""",

    ProductStage.SYSTEM_DESIGN: """You are a systems architect. Make technical decisions for this product.

FEATURES: {feature_set}
SOLUTION: {solution_frame}

Output JSON with:
- architecture_style: Monolith, microservices, serverless, etc.
- tech_stack: Frontend, backend, database choices with brief justification
- data_entities: Key data models (name and fields)
- key_services: Main backend services needed
- infrastructure: Hosting approach

RULES:
- Prefer simple, conservative defaults
- No buzzword stacks
- Justify every major decision in one sentence""",

    ProductStage.RISK_ANALYSIS: """You are a risk analyst. Surface real risks for this product.

SYSTEM: {system_design}
FEATURES: {feature_set}
PROBLEM: {problem_definition}

Output JSON with:
- technical_risks: List with risk and mitigation
- business_risks: Market and adoption risks
- legal_risks: Privacy, compliance, liability concerns
- scaling_risks: What breaks at 10x, 100x scale
- assumptions: Critical assumptions that could be wrong

Be honest. Don't downplay risks.""",

    ProductStage.MVP_DEFINITION: """You are an MVP specialist. Define the smallest shippable product.

FEATURES: {feature_set}
RISKS: {risk_profile}
PROBLEM: {problem_definition}

Output JSON with:
- mvp_features: Minimal feature list (be ruthless)
- excluded_features: What's cut and why
- success_metrics: 3-5 measurable outcomes
- time_estimate: Rough weeks to build
- user_outcome: What one thing can users accomplish

Prevent scope creep. Ship something real.""",

    ProductStage.MILESTONE_PLANNING: """You are a project planner. Break the MVP into executable phases.

MVP: {mvp_scope}
SYSTEM: {system_design}

Output JSON with:
- milestones: List of phases with name, goals, deliverables, weeks
- dependencies: What must happen in order
- phase_1_focus: What to build first
- launch_criteria: When is it ready to ship

Keep it realistic. 2-4 milestones max.""",

    ProductStage.PRD_ASSEMBLY: """Compile a complete PRD document from our entire conversation.

VERSION: v{version}

Output in Markdown. Be concise. Start with:
# PRD: [Product Name] v{version}

Include: Executive Summary, Problem, Users, Solution, Features, Tech Architecture, Risks, MVP Scope, Milestones.""",
}


class ProductPipeline:
    """Executes the 10-stage product design pipeline."""
    
    def __init__(self, state: ProductState):
        self.state = state
        if not self.state.session_key:
            self.state.session_key = f"product-{id(self.state)}"
        logger.info(f"ProductPipeline initialized with session: {self.state.session_key}")
        logger.info(f"  User input: {self.state.user_input[:100]}...")
    
    async def run(self) -> AsyncGenerator[dict, None]:
        """Execute all stages, yielding progress events."""
        logger.info("Starting product pipeline run")
        
        for stage in STAGE_ORDER:
            logger.info(f"=== Starting stage: {stage.value} ===")
            yield {
                "type": "stage_start",
                "stage": stage.value,
                "summary": STAGE_SUMMARIES[stage],
            }
            
            try:
                result = await self._run_stage(stage)
                logger.info(f"Stage {stage.value} completed, result length: {len(result)}")
                
                # Store result in state
                self._store_result(stage, result)
                
                yield {
                    "type": "stage_complete",
                    "stage": stage.value,
                    "detail": self._get_detail(stage, result),
                }
                
            except Exception as e:
                logger.error(f"Stage {stage.value} failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
                yield {
                    "type": "stage_failed",
                    "stage": stage.value,
                    "error": str(e),
                }
                return
        
        logger.info("Pipeline complete!")
        # Final PRD is ready
        yield {
            "type": "prd_complete",
            "version": self.state.version,
            "prd": self.state.prd_final,
        }
    
    async def _run_stage(self, stage: ProductStage) -> str:
        """Execute a single stage via Backboard."""
        logger.info(f"_run_stage: {stage.value}")
        prompt_template = STAGE_PROMPTS[stage]
        
        # Build context from state
        context = {
            "user_input": self.state.user_input,
            "product_concept": json.dumps(self.state.product_concept) if self.state.product_concept else "{}",
            "problem_definition": json.dumps(self.state.problem_definition) if self.state.problem_definition else "{}",
            "user_model": json.dumps(self.state.user_model) if self.state.user_model else "{}",
            "solution_frame": json.dumps(self.state.solution_frame) if self.state.solution_frame else "{}",
            "feature_set": json.dumps(self.state.feature_set) if self.state.feature_set else "{}",
            "system_design": json.dumps(self.state.system_design) if self.state.system_design else "{}",
            "risk_profile": json.dumps(self.state.risk_profile) if self.state.risk_profile else "{}",
            "mvp_scope": json.dumps(self.state.mvp_scope) if self.state.mvp_scope else "{}",
            "delivery_plan": json.dumps(self.state.delivery_plan) if self.state.delivery_plan else "{}",
            "version": self.state.version,
        }
        
        prompt = prompt_template.format(**context)
        logger.debug(f"Prompt length: {len(prompt)}")
        
        system_prompt = f"You are executing stage '{stage.value}' of a product design pipeline. Output valid JSON unless this is the PRD assembly stage."
        
        logger.info(f"Calling backboard.send_message for stage {stage.value}")
        response = await backboard.send_message(
            session_key=self.state.session_key,
            content=prompt,
            system_prompt=system_prompt,
        )
        logger.info(f"Backboard response received, length: {len(response)}")
        
        return response
    
    def _store_result(self, stage: ProductStage, result: str):
        """Parse and store stage result in state."""
        # PRD assembly returns markdown, not JSON
        if stage == ProductStage.PRD_ASSEMBLY:
            self.state.prd_final = result
            return
        
        try:
            # Try to parse JSON from response
            # Handle markdown code blocks
            clean = result.strip()
            if clean.startswith("```json"):
                clean = clean[7:]
            if clean.startswith("```"):
                clean = clean[3:]
            if clean.endswith("```"):
                clean = clean[:-3]
            
            data = json.loads(clean.strip())
        except json.JSONDecodeError:
            # Store raw if can't parse
            data = {"raw": result}
        
        stage_to_attr = {
            ProductStage.IDEA_GROUNDING: "product_concept",
            ProductStage.PROBLEM_DEFINITION: "problem_definition",
            ProductStage.USER_FRAMING: "user_model",
            ProductStage.SOLUTION_SHAPING: "solution_frame",
            ProductStage.FEATURE_DECOMPOSITION: "feature_set",
            ProductStage.SYSTEM_DESIGN: "system_design",
            ProductStage.RISK_ANALYSIS: "risk_profile",
            ProductStage.MVP_DEFINITION: "mvp_scope",
            ProductStage.MILESTONE_PLANNING: "delivery_plan",
        }
        
        attr = stage_to_attr.get(stage)
        if attr:
            setattr(self.state, attr, data)
    
    def _get_detail(self, stage: ProductStage, result: str) -> str:
        """Get a short detail string for the stage result."""
        if stage == ProductStage.IDEA_GROUNDING and self.state.product_concept:
            return self.state.product_concept.get("product_name", "")[:50]
        if stage == ProductStage.PROBLEM_DEFINITION and self.state.problem_definition:
            return self.state.problem_definition.get("problem_statement", "")[:50]
        if stage == ProductStage.PRD_ASSEMBLY:
            return f"PRD v{self.state.version} ready"
        return ""
    
    def create_revision(self, revision_request: str) -> "ProductPipeline":
        """Create a new pipeline for revision, preserving prior state."""
        # Store current version
        if self.state.prd_final:
            self.state.prior_versions.append({
                "version": self.state.version,
                "prd": self.state.prd_final,
            })
        
        # Create new state with revision context
        new_state = ProductState(
            user_input=f"{self.state.user_input}\n\nREVISION REQUEST: {revision_request}",
            version=self.state.version + 1,
            session_key=self.state.session_key,  # Same session for memory
            revision_request=revision_request,
            prior_versions=self.state.prior_versions,
        )
        
        return ProductPipeline(new_state)
