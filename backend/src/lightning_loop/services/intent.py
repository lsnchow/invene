"""Intent classification for routing to appropriate pipeline."""
from enum import Enum
from lightning_loop.backboard.client import backboard


class Intent(str, Enum):
    DESIGN_PRODUCT = "design_product"
    DEBUG_CODE = "debug_code"
    UNKNOWN = "unknown"


CLASSIFICATION_PROMPT = """Classify the user's intent into exactly one category.

Categories:
- design_product: User wants to create, design, or build a new product, app, or feature. They describe an idea, concept, or product vision.
- debug_code: User has an error, bug, or wants help fixing/modifying existing code. They paste error messages, stack traces, or describe a coding problem.

USER INPUT:
{user_input}

Output ONLY one word: design_product or debug_code"""


async def classify_intent(user_input: str) -> tuple[Intent, float]:
    """
    Classify user input into design_product or debug_code intent.
    Returns (intent, confidence).
    """
    # Fast heuristics first
    lower = user_input.lower()
    
    # Strong debug signals
    debug_signals = [
        "error:", "traceback", "exception", "failed", "doesn't work",
        "bug", "fix", "broken", "crash", "undefined", "null", "typeerror",
        "syntaxerror", "importerror", "line ", "at line", "stack trace"
    ]
    
    # Strong product signals
    product_signals = [
        "i want to build", "i want to create", "make a", "build a",
        "create a", "an app that", "a tool that", "a saas", "a platform",
        "product idea", "startup idea", "like uber for", "like tinder for",
        "like airbnb for"
    ]
    
    debug_score = sum(1 for s in debug_signals if s in lower)
    product_score = sum(1 for s in product_signals if s in lower)
    
    # Clear winner from heuristics
    if product_score >= 2 and debug_score == 0:
        return Intent.DESIGN_PRODUCT, 0.95
    
    if debug_score >= 2 and product_score == 0:
        return Intent.DEBUG_CODE, 0.95
    
    # Ambiguous - ask LLM
    try:
        response = await backboard.one_shot(
            prompt=CLASSIFICATION_PROMPT.format(user_input=user_input[:500]),
            system_prompt="You are an intent classifier. Output exactly one word."
        )
        
        clean = response.strip().lower()
        
        if "design_product" in clean:
            return Intent.DESIGN_PRODUCT, 0.85
        elif "debug" in clean:
            return Intent.DEBUG_CODE, 0.85
        else:
            # Default to product design if truly ambiguous
            return Intent.DESIGN_PRODUCT, 0.5
            
    except Exception:
        # On error, use heuristic winner or default
        if product_score > debug_score:
            return Intent.DESIGN_PRODUCT, 0.6
        elif debug_score > product_score:
            return Intent.DEBUG_CODE, 0.6
        else:
            return Intent.UNKNOWN, 0.3
