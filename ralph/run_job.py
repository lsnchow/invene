#!/usr/bin/env python3
"""
Ralph Job Runner - Executes jobs by automating Copilot Chat.

Uses pyautogui to physically interact with the IDE:
- Sends prompts via coordinate click + paste
- Detects completion via pixel signature change
- Copies responses via right-click menu
"""
import sys
import json
import time
import signal
import hashlib
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

# Automation imports
import pyautogui
import pyperclip
from PIL import ImageGrab


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Config:
    # Input injection coordinates (Copilot Chat input field)
    copilot_input_x: int = 1054
    copilot_input_y: int = 858
    
    # Done-signal probe (area that changes when Copilot finishes)
    probe_center_x: int = 1223
    probe_center_y: int = 881
    probe_tolerance: int = 2
    
    # Copy-back coordinates (right-click to copy response)
    copy_anchor_x: int = 1053
    copy_anchor_y: int = 721
    copy_menu_offset_x: int = 5
    copy_menu_offset_y: int = 5
    
    # Timing
    post_submit_buffer: float = 2.0
    poll_interval: float = 1.0
    post_done_buffer: float = 3.0
    click_delay: float = 0.1
    menu_delay: float = 0.2
    clipboard_delay: float = 0.2
    
    # Limits
    timeout: float = 180.0
    copy_retries: int = 2


CONFIG = Config()


# ═══════════════════════════════════════════════════════════════════════════════
# OUTPUT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def emit_event(event_type: str, **data):
    """Emit a JSON event to stdout for Electron to consume."""
    event = {
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        **data
    }
    print(json.dumps(event), flush=True)


# Global flag for graceful shutdown
_shutdown_requested = False

def handle_signal(signum, frame):
    global _shutdown_requested
    emit_event("log", message=f"Received signal {signum}, stopping...")
    _shutdown_requested = True


# ═══════════════════════════════════════════════════════════════════════════════
# PIXEL SIGNATURE DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def capture_signature(center_x: int, center_y: int, tolerance: int = 2) -> str:
    """Capture a pixel signature from a small region for change detection."""
    left = center_x - tolerance
    top = center_y - tolerance
    right = center_x + tolerance + 1
    bottom = center_y + tolerance + 1
    
    region = ImageGrab.grab(bbox=(left, top, right, bottom))
    pixels = list(region.getdata())
    
    return hashlib.md5(str(pixels).encode()).hexdigest()


# ═══════════════════════════════════════════════════════════════════════════════
# COPILOT INTERACTION
# ═══════════════════════════════════════════════════════════════════════════════

def send_to_copilot(message: str) -> None:
    """Inject a message into Copilot Chat."""
    # First copy to clipboard
    pyperclip.copy(message)
    time.sleep(0.1)
    
    # Click on input field
    pyautogui.click(CONFIG.copilot_input_x, CONFIG.copilot_input_y)
    time.sleep(CONFIG.click_delay)
    
    # Paste using keyDown/keyUp (more reliable than hotkey on macOS)
    pyautogui.keyDown('command')
    time.sleep(0.05)
    pyautogui.press('v')
    time.sleep(0.05)
    pyautogui.keyUp('command')
    time.sleep(CONFIG.click_delay)
    
    # Submit
    pyautogui.press('enter')
    emit_event("action", description=f"Sent prompt ({len(message)} chars)")


def wait_for_done(timeout: float = None) -> bool:
    """Poll for done-signal using pixel signature change."""
    global _shutdown_requested
    timeout = timeout or CONFIG.timeout
    
    emit_event("action", description="Waiting for Copilot to respond...")
    time.sleep(CONFIG.post_submit_buffer)
    
    baseline = capture_signature(
        CONFIG.probe_center_x, 
        CONFIG.probe_center_y,
        CONFIG.probe_tolerance
    )
    
    start_time = time.time()
    poll_count = 0
    
    while (time.time() - start_time) < timeout and not _shutdown_requested:
        time.sleep(CONFIG.poll_interval)
        poll_count += 1
        
        current = capture_signature(
            CONFIG.probe_center_x,
            CONFIG.probe_center_y,
            CONFIG.probe_tolerance
        )
        
        if current != baseline:
            emit_event("action", description=f"Response detected after {poll_count} polls")
            time.sleep(CONFIG.post_done_buffer)
            return True
    
    if _shutdown_requested:
        return False
    
    emit_event("action", description=f"Timeout after {timeout}s")
    return False


def copy_response() -> Optional[str]:
    """Copy Copilot's response via right-click menu."""
    old_clipboard = pyperclip.paste()
    
    # Scroll to ensure latest response is visible
    pyautogui.scroll(-10)
    time.sleep(0.3)
    
    for attempt in range(CONFIG.copy_retries):
        pyautogui.click(CONFIG.copy_anchor_x, CONFIG.copy_anchor_y, button='right')
        time.sleep(CONFIG.menu_delay)
        
        pyautogui.click(
            CONFIG.copy_anchor_x + CONFIG.copy_menu_offset_x,
            CONFIG.copy_anchor_y + CONFIG.copy_menu_offset_y
        )
        time.sleep(CONFIG.clipboard_delay)
        
        new_clipboard = pyperclip.paste()
        
        if new_clipboard != old_clipboard:
            emit_event("action", description=f"Copied response ({len(new_clipboard)} chars)")
            return new_clipboard
        
        time.sleep(0.5)
    
    emit_event("action", description="Failed to copy response")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# JOB EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════

def build_prompt_from_job(job: dict, iteration: int = 1) -> str:
    """Build a Copilot prompt from job specification."""
    parts = [f"# Task: {job['title']}", ""]
    
    if job.get("objective"):
        parts.append(f"**Objective:** {job['objective']}")
        parts.append("")
    
    if job.get("scope_included"):
        parts.append("**In Scope:**")
        for item in job["scope_included"]:
            parts.append(f"- {item}")
        parts.append("")
    
    if job.get("constraints"):
        parts.append("**Constraints:**")
        for item in job["constraints"]:
            parts.append(f"- {item}")
        parts.append("")
    
    if job.get("success_criteria"):
        parts.append("**Success Criteria:**")
        for item in job["success_criteria"]:
            parts.append(f"- {item}")
        parts.append("")
    
    if iteration > 1:
        parts.append(f"(Iteration {iteration} - continue from previous work)")
    
    return "\n".join(parts)


def run_job(job: dict) -> dict:
    """Execute a single job using Copilot automation."""
    global _shutdown_requested
    
    job_id = job.get("job_id", "unknown")
    title = job.get("title", "Untitled")
    max_iterations = job.get("estimated_iterations", 5)
    
    emit_event("started", job_id=job_id, title=title, max_iterations=max_iterations)
    
    iterations_used = 0
    outputs = []
    
    for iteration in range(1, max_iterations + 1):
        if _shutdown_requested:
            break
        
        iterations_used = iteration
        emit_event("iteration", job_id=job_id, iteration=iteration, max=max_iterations)
        
        # Build and send prompt
        prompt = build_prompt_from_job(job, iteration)
        send_to_copilot(prompt)
        
        # Wait for response
        done = wait_for_done()
        
        if not done:
            emit_event("log", message="Proceeding despite timeout")
        
        # Copy response
        response = copy_response()
        
        if response:
            outputs.append(response)
            
            # Check for completion signals in response
            completion_signals = [
                "implementation is complete",
                "task is complete", 
                "successfully implemented",
                "all requirements met",
                "✓ done",
                "finished implementing",
            ]
            
            response_lower = response.lower()
            for signal in completion_signals:
                if signal in response_lower:
                    emit_event("log", message=f"Completion signal detected: '{signal}'")
                    return {
                        "success": True,
                        "job_id": job_id,
                        "iterations_used": iterations_used,
                        "stop_reason": "objective_complete",
                        "outputs": outputs,
                    }
    
    return {
        "success": True,  # Completed all iterations
        "job_id": job_id,
        "iterations_used": iterations_used,
        "stop_reason": "max_iterations",
        "outputs": outputs,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    
    if len(sys.argv) < 2:
        emit_event("error", message="Usage: run_job.py <job_json>")
        sys.exit(1)
    
    try:
        job = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        emit_event("error", message=f"Invalid JSON: {e}")
        sys.exit(1)
    
    emit_event("log", message=f"Starting job: {job.get('title', 'Unknown')}")
    
    result = run_job(job)
    
    if result.get("success"):
        emit_event("completed", **result)
    else:
        emit_event("error", **result)
    
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
