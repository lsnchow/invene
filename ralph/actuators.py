"""
Ralph Loop Actuators - External systems that execute actions.

Actuators are purely mechanical. They execute exactly what they're told
and report results. No reasoning, no retries, no judgment.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Any, Dict
from enum import Enum
import time
import subprocess


class ActionOutcome(Enum):
    """Possible outcomes of an action."""
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"
    PARTIAL = "partial"


@dataclass
class ActionResult:
    """Result from an actuator execution."""
    outcome: ActionOutcome
    output: Optional[str] = None
    error: Optional[str] = None
    duration: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


class Actuator(ABC):
    """Base class for all actuators."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name of this actuator."""
        pass
    
    @abstractmethod
    def execute(self, action: str, **kwargs) -> ActionResult:
        """
        Execute an action. Returns result with outcome.
        No retries, no branching, no judgment.
        """
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if actuator is ready to execute."""
        pass


class CopilotActuator(Actuator):
    """
    Actuator for GitHub Copilot Chat.
    Sends prompts and captures responses via coordinate automation.
    """
    
    def __init__(self):
        self._initialized = False
        self._send = None
        self._wait = None
        self._copy = None
        self._config = None
    
    def _ensure_initialized(self):
        """Lazy initialization to avoid circular imports."""
        if not self._initialized:
            import sys
            import os
            # Add parent directory to path
            parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if parent not in sys.path:
                sys.path.insert(0, parent)
            
            from test import (
                send_to_copilot, 
                wait_for_done, 
                copy_response,
                CONFIG
            )
            self._send = send_to_copilot
            self._wait = wait_for_done
            self._copy = copy_response
            self._config = CONFIG
            self._initialized = True
    
    @property
    def name(self) -> str:
        return "copilot"
    
    def execute(self, action: str, **kwargs) -> ActionResult:
        """
        Send a prompt to Copilot and capture the response.
        
        Args:
            action: The prompt to send
            timeout: Optional timeout override
        """
        self._ensure_initialized()
        
        start = time.time()
        timeout = kwargs.get("timeout", self._config.timeout)
        
        try:
            # Send prompt
            self._send(action)
            
            # Wait for completion
            done = self._wait(timeout=timeout)
            
            if not done:
                return ActionResult(
                    outcome=ActionOutcome.TIMEOUT,
                    error=f"Copilot did not respond within {timeout}s",
                    duration=time.time() - start,
                )
            
            # Copy response
            response = self._copy()
            
            if response is None:
                return ActionResult(
                    outcome=ActionOutcome.FAILURE,
                    error="Failed to copy Copilot response",
                    duration=time.time() - start,
                )
            
            return ActionResult(
                outcome=ActionOutcome.SUCCESS,
                output=response,
                duration=time.time() - start,
            )
            
        except Exception as e:
            return ActionResult(
                outcome=ActionOutcome.FAILURE,
                error=str(e),
                duration=time.time() - start,
            )
    
    def is_available(self) -> bool:
        """Check if Copilot automation is available."""
        try:
            import pyautogui
            import pyperclip
            return True
        except ImportError:
            return False


class TerminalActuator(Actuator):
    """
    Actuator for terminal command execution.
    """
    
    def __init__(self, cwd: str = None):
        self.cwd = cwd
    
    @property
    def name(self) -> str:
        return "terminal"
    
    def execute(self, action: str, **kwargs) -> ActionResult:
        """
        Execute a terminal command.
        
        Args:
            action: The command to run
            timeout: Command timeout in seconds
        """
        start = time.time()
        timeout = kwargs.get("timeout", 60)
        
        try:
            result = subprocess.run(
                action,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=self.cwd,
            )
            
            outcome = ActionOutcome.SUCCESS if result.returncode == 0 else ActionOutcome.FAILURE
            
            return ActionResult(
                outcome=outcome,
                output=result.stdout,
                error=result.stderr if result.returncode != 0 else None,
                duration=time.time() - start,
                metadata={"returncode": result.returncode},
            )
            
        except subprocess.TimeoutExpired:
            return ActionResult(
                outcome=ActionOutcome.TIMEOUT,
                error=f"Command timed out after {timeout}s",
                duration=time.time() - start,
            )
        except Exception as e:
            return ActionResult(
                outcome=ActionOutcome.FAILURE,
                error=str(e),
                duration=time.time() - start,
            )
    
    def is_available(self) -> bool:
        return True
