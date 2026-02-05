"""
Copilot Automation Loop
- Injects prompts via coordinate click + paste
- Detects done via pixel signature change
- Copies response via right-click menu
- Summarizes and loops
"""

import pyautogui
import pyperclip
import time
from PIL import ImageGrab
from dataclasses import dataclass, field
from typing import Optional, Tuple, Callable
import hashlib


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Config:
    # Input injection
    copilot_input_x: int = 1054
    copilot_input_y: int = 858
    
    # Done-signal probe
    probe_center_x: int = 1223
    probe_center_y: int = 881
    probe_tolerance: int = 2  # ±2 px
    
    # Copy-back
    copy_anchor_x: int = 1053
    copy_anchor_y: int = 721
    copy_menu_offset_x: int = 5
    copy_menu_offset_y: int = 5
    
    # Timing
    post_submit_buffer: float = 2.0  # Wait before first poll
    poll_interval: float = 1.0       # Poll every N seconds
    post_done_buffer: float = 5.0    # Wait after done before copy
    click_delay: float = 0.1
    menu_delay: float = 0.2          # Wait for context menu
    clipboard_delay: float = 0.2     # Wait after copy click
    
    # Limits
    timeout: float = 300.0           # Hard cap per iteration
    max_iterations: int = 20
    copy_retries: int = 2


CONFIG = Config()


# ═══════════════════════════════════════════════════════════════════════════════
# PIXEL SIGNATURE DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def capture_signature(center_x: int, center_y: int, tolerance: int = 2) -> str:
    """
    Capture a pixel signature from a 5x5 region centered at (center_x, center_y).
    Returns a hash of the pixel colors for comparison.
    """
    left = center_x - tolerance
    top = center_y - tolerance
    right = center_x + tolerance + 1
    bottom = center_y + tolerance + 1
    
    region = ImageGrab.grab(bbox=(left, top, right, bottom))
    pixels = list(region.getdata())
    
    pixel_str = str(pixels)
    return hashlib.md5(pixel_str.encode()).hexdigest()


def capture_extended_signature(center_x: int, center_y: int, tolerance: int = 2) -> str:
    """Capture signatures from 25 overlapping 5x5 squares for noise resistance."""
    signatures = []
    for dx in range(-tolerance, tolerance + 1):
        for dy in range(-tolerance, tolerance + 1):
            sig = capture_signature(center_x + dx, center_y + dy, tolerance=2)
            signatures.append(sig)
    return hashlib.md5("".join(signatures).encode()).hexdigest()


# ═══════════════════════════════════════════════════════════════════════════════
# CORE ACTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def send_to_copilot(message: str) -> None:
    """Inject a message into Copilot Chat."""
    pyperclip.copy(message)
    pyautogui.click(CONFIG.copilot_input_x, CONFIG.copilot_input_y)
    time.sleep(CONFIG.click_delay)
    pyautogui.hotkey('command', 'v')
    time.sleep(CONFIG.click_delay)
    pyautogui.press('enter')
    print(f"→ Sent: {message[:60]}{'...' if len(message) > 60 else ''}")


def wait_for_done(timeout: float = None) -> bool:
    """Poll for done-signal using pixel signature change."""
    timeout = timeout or CONFIG.timeout
    
    print(f"⏳ Waiting {CONFIG.post_submit_buffer}s before polling...")
    time.sleep(CONFIG.post_submit_buffer)
    
    baseline = capture_signature(
        CONFIG.probe_center_x, 
        CONFIG.probe_center_y,
        CONFIG.probe_tolerance
    )
    print(f"📸 Baseline signature: {baseline[:8]}...")
    
    start_time = time.time()
    poll_count = 0
    
    while (time.time() - start_time) < timeout:
        time.sleep(CONFIG.poll_interval)
        poll_count += 1
        
        current = capture_signature(
            CONFIG.probe_center_x,
            CONFIG.probe_center_y,
            CONFIG.probe_tolerance
        )
        
        if current != baseline:
            print(f"✓ Done detected after {poll_count} polls ({time.time() - start_time:.1f}s)")
            print(f"⏳ Settling for {CONFIG.post_done_buffer}s...")
            time.sleep(CONFIG.post_done_buffer)
            return True
        
        if poll_count % 10 == 0:
            elapsed = time.time() - start_time
            print(f"  ... polling ({poll_count} polls, {elapsed:.0f}s)")
    
    print(f"⚠ Timeout after {timeout}s")
    return False


def copy_response() -> Optional[str]:
    """Copy Copilot's response via right-click menu."""
    old_clipboard = pyperclip.paste()
    
    # Scroll to bottom to ensure latest response is visible
    pyautogui.scroll(-10)  # Scroll down
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
            print(f"← Copied: {len(new_clipboard)} chars")
            return new_clipboard
        
        print(f"  Copy attempt {attempt + 1} failed, retrying...")
        time.sleep(0.5)
    
    print("⚠ Copy-back failed after retries")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# LOOP RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class LoopState:
    iteration: int = 0
    outputs: list = field(default_factory=list)
    summaries: list = field(default_factory=list)
    stopped: bool = False
    stop_reason: Optional[str] = None


def run_loop(
    initial_prompt: str,
    next_prompt_fn: Callable[[str, LoopState], Optional[str]],
    stop_condition_fn: Callable[[str, LoopState], bool] = None,
    summarize_fn: Callable[[str], str] = None,
    max_iterations: int = None
) -> LoopState:
    """Run the full automation loop."""
    max_iterations = max_iterations or CONFIG.max_iterations
    state = LoopState()
    current_prompt = initial_prompt
    
    print("═" * 60)
    print("🚀 Starting Copilot Loop")
    print("═" * 60)
    
    while state.iteration < max_iterations and not state.stopped:
        state.iteration += 1
        print(f"\n{'─' * 40}")
        print(f"📍 Iteration {state.iteration}/{max_iterations}")
        print("─" * 40)
        
        send_to_copilot(current_prompt)
        done = wait_for_done()
        
        if not done:
            print("⚠ Proceeding despite timeout")
        
        response = copy_response()
        
        if response is None:
            state.stopped = True
            state.stop_reason = "copy_failed"
            break
        
        state.outputs.append(response)
        
        if summarize_fn:
            summary = summarize_fn(response)
            state.summaries.append(summary)
            print(f"📝 Summary: {summary[:100]}...")
        
        if stop_condition_fn and stop_condition_fn(response, state):
            state.stopped = True
            state.stop_reason = "stop_condition_met"
            print("✓ Stop condition met")
            break
        
        next_prompt = next_prompt_fn(response, state)
        
        if next_prompt is None:
            state.stopped = True
            state.stop_reason = "no_next_prompt"
            break
        
        current_prompt = next_prompt
    
    if state.iteration >= max_iterations:
        state.stopped = True
        state.stop_reason = "max_iterations"
    
    print("\n" + "═" * 60)
    print(f"🏁 Loop finished: {state.stop_reason}")
    print(f"   Iterations: {state.iteration}")
    print(f"   Outputs: {len(state.outputs)}")
    print("═" * 60)
    
    return state


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def calibrate_position(label: str = "target", delay: float = 3.0) -> Tuple[int, int]:
    """Get current mouse position after delay."""
    print(f"Move mouse to {label} in {delay}s...")
    time.sleep(delay)
    x, y = pyautogui.position()
    print(f"{label}: ({x}, {y})")
    return x, y


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        
        if cmd == "--pos":
            calibrate_position("target")
        
        elif cmd == "--sig":
            print("Testing signature at probe location...")
            sig1 = capture_signature(CONFIG.probe_center_x, CONFIG.probe_center_y)
            print(f"Signature 1: {sig1}")
            time.sleep(1)
            sig2 = capture_signature(CONFIG.probe_center_x, CONFIG.probe_center_y)
            print(f"Signature 2: {sig2}")
            print(f"Match: {sig1 == sig2}")
        
        elif cmd == "--copy":
            print("Testing copy-back in 3s...")
            time.sleep(3)
            result = copy_response()
            if result:
                print(f"Copied:\n{result[:500]}")
            else:
                print("Copy failed")
        
        elif cmd == "--send":
            msg = sys.argv[2] if len(sys.argv) > 2 else "Hello from automation!"
            print(f"Sending in 2s...")
            time.sleep(2)
            send_to_copilot(msg)
        
        elif cmd == "--single":
            msg = sys.argv[2] if len(sys.argv) > 2 else "What is 2+2?"
            print(f"Single iteration in 2s...")
            time.sleep(2)
            send_to_copilot(msg)
            wait_for_done()
            response = copy_response()
            if response:
                print(f"\n{'─'*40}\nResponse:\n{'─'*40}\n{response}\n{'─'*40}")
        
        else:
            print(f"Unknown command: {cmd}")
            print("Commands: --pos | --sig | --copy | --send [msg] | --single [msg]")
    
    else:
        print("Commands:")
        print("  --pos          Get mouse position")
        print("  --sig          Test signature capture")
        print("  --copy         Test copy-back")
        print("  --send [msg]   Send a message")
        print("  --single [msg] Full single iteration")
