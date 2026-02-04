"""Backboard API client."""
import httpx
from typing import Any

from lightning_loop.core.config import settings


class BackboardClient:
    """Client for interacting with Backboard API."""
    
    def __init__(self):
        self.api_key = settings.backboard_api_key
        self.base_url = settings.backboard_base_url.rstrip("/")
        self.model = settings.backboard_model
        self.provider = settings.backboard_provider
        self.headers = {
            "X-API-Key": self.api_key,
            "Accept": "application/json",
        }
        self._assistant_id: str | None = None
        self._thread_cache: dict[str, str] = {}
    
    @property
    def is_configured(self) -> bool:
        """Check if Backboard is configured."""
        return bool(self.api_key)
    
    async def _ensure_assistant(self, system_prompt: str) -> str:
        """Ensure an assistant exists for the given system prompt."""
        if self._assistant_id:
            return self._assistant_id
        
        url = f"{self.base_url}/assistants"
        payload = {
            "name": "Lightning Loop Assistant",
            "system_prompt": system_prompt,
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=self.headers, json=payload)
        
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to create assistant: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        self._assistant_id = data.get("assistant_id") or data.get("id")
        return self._assistant_id
    
    async def _get_or_create_thread(self, session_key: str, system_prompt: str) -> str:
        """Get or create a thread for the session."""
        if session_key in self._thread_cache:
            return self._thread_cache[session_key]
        
        assistant_id = await self._ensure_assistant(system_prompt)
        url = f"{self.base_url}/assistants/{assistant_id}/threads"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # MUST send json={} - empty body causes 422!
            resp = await client.post(url, headers=self.headers, json={})
        
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to create thread: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        thread_id = data.get("thread_id") or data.get("id")
        self._thread_cache[session_key] = thread_id
        return thread_id
    
    async def send_message(
        self,
        session_key: str,
        content: str,
        system_prompt: str,
        memory: str = "Auto",
    ) -> str:
        """Send a message and get a response."""
        if not self.is_configured:
            raise Exception("Backboard API key not configured")
        
        thread_id = await self._get_or_create_thread(session_key, system_prompt)
        url = f"{self.base_url}/threads/{thread_id}/messages"
        
        # FORM DATA - not JSON!
        form_data = {
            "content": content,
            "stream": "false",
            "memory": memory,
            "model": self.model,
            "provider": self.provider,
        }
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, headers=self.headers, data=form_data)
        
        if resp.status_code != 200:
            raise Exception(f"Failed to send message: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        return data.get("content") or data.get("text") or ""
    
    async def one_shot(self, prompt: str, system_prompt: str) -> str:
        """Send a one-shot query without memory."""
        if not self.is_configured:
            raise Exception("Backboard API key not configured")
        
        # Create fresh assistant and thread for one-shot
        url = f"{self.base_url}/assistants"
        payload = {
            "name": "Lightning Loop One-Shot",
            "system_prompt": system_prompt,
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=self.headers, json=payload)
        
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to create assistant: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        assistant_id = data.get("assistant_id") or data.get("id")
        
        # Create thread
        url = f"{self.base_url}/assistants/{assistant_id}/threads"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=self.headers, json={})
        
        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to create thread: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        thread_id = data.get("thread_id") or data.get("id")
        
        # Send message with memory off
        url = f"{self.base_url}/threads/{thread_id}/messages"
        form_data = {
            "content": prompt,
            "stream": "false",
            "memory": "off",
            "model": self.model,
            "provider": self.provider,
        }
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, headers=self.headers, data=form_data)
        
        if resp.status_code != 200:
            raise Exception(f"Failed to send message: {resp.status_code} - {resp.text}")
        
        data = resp.json()
        return data.get("content") or data.get("text") or ""


# Singleton instance
backboard = BackboardClient()
