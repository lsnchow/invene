#!/usr/bin/env python3
"""
Ralph Loop Runner - Quick test/demo script.

Usage:
    python run_ralph.py "Your objective here"
    python run_ralph.py --terminal "ls -la"
    python run_ralph.py --copilot "Fix the bug in utils.py"
"""

import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ralph import (
    RalphLoop, 
    LoopConfig, 
    CopilotActuator, 
    TerminalActuator,
    create_copilot_loop,
)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nQuick test with terminal actuator...")
        
        # Demo with terminal
        loop = RalphLoop(
            objective="echo 'Hello from Ralph Loop!'",
            actuator=TerminalActuator(),
            config=LoopConfig(max_iterations=1),
        )
        result = loop.run()
        print(f"\nFinal summary:\n{result.final_summary}")
        return
    
    mode = sys.argv[1]
    
    if mode == "--terminal":
        objective = sys.argv[2] if len(sys.argv) > 2 else "echo 'test'"
        loop = RalphLoop(
            objective=objective,
            actuator=TerminalActuator(),
            config=LoopConfig(max_iterations=5),
        )
    
    elif mode == "--copilot":
        objective = sys.argv[2] if len(sys.argv) > 2 else "What is 2+2?"
        print("Starting Copilot loop in 3 seconds...")
        print("Make sure VS Code with Copilot Chat is visible!")
        import time
        time.sleep(3)
        
        loop = create_copilot_loop(
            objective=objective,
            config=LoopConfig(max_iterations=5),
        )
    
    else:
        # Treat as objective for copilot
        objective = " ".join(sys.argv[1:])
        print(f"Starting Copilot loop for: {objective}")
        print("Make sure VS Code with Copilot Chat is visible!")
        print("Starting in 3 seconds...")
        import time
        time.sleep(3)
        
        loop = create_copilot_loop(
            objective=objective,
            config=LoopConfig(max_iterations=5),
        )
    
    # Run the loop
    result = loop.run()
    
    # Print results
    print("\n" + "═" * 60)
    print("FINAL SUMMARY")
    print("═" * 60)
    print(result.final_summary)
    
    print("\n" + "═" * 60)
    print("NARRATIVES")
    print("═" * 60)
    loop.print_narratives()


if __name__ == "__main__":
    main()
