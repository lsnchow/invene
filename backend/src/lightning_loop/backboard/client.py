"""Backboard API client."""
import httpx
import logging
from typing import Any

from lightning_loop.core.config import settings

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


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
        
        logger.info(f"BackboardClient initialized")
        logger.info(f"  Base URL: {self.base_url}")
        logger.info(f"  Model: {self.model}")
        logger.info(f"  Provider: {self.provider}")
        logger.info(f"  API Key configured: {bool(self.api_key)}")
        if self.api_key:
            logger.info(f"  API Key prefix: {self.api_key[:10]}...")
    
    @property
    def is_configured(self) -> bool:
        """Check if Backboard is configured."""
        return bool(self.api_key)
    
    async def _ensure_assistant(self, system_prompt: str) -> str:
        """Ensure an assistant exists for the given system prompt."""
        if self._assistant_id:
            logger.debug(f"Reusing existing assistant: {self._assistant_id}")
            return self._assistant_id
        
        url = f"{self.base_url}/assistants"
        payload = {
            "name": "Lightning Loop Assistant",
            "system_prompt": system_prompt[:200],  # Truncate for logging
        }
        
        logger.info(f"Creating assistant at {url}")
        logger.debug(f"  Payload: {payload}")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=self.headers, json=payload)
            
            logger.info(f"  Response status: {resp.status_code}")
            logger.debug(f"  Response body: {resp.text[:500]}")
            
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed to create assistant: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            self._assistant_id = data.get("assistant_id") or data.get("id")
            logger.info(f"  Created assistant: {self._assistant_id}")
            return self._assistant_id
        except Exception as e:
            logger.error(f"Error creating assistant: {e}")
            raise
    
    async def _get_or_create_thread(self, session_key: str, system_prompt: str) -> str:
        """Get or create a thread for the session."""
        if session_key in self._thread_cache:
            logger.debug(f"Reusing cached thread for session: {session_key}")
            return self._thread_cache[session_key]
        
        assistant_id = await self._ensure_assistant(system_prompt)
        url = f"{self.base_url}/assistants/{assistant_id}/threads"
        
        logger.info(f"Creating thread at {url}")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=self.headers, json={})
            
            logger.info(f"  Response status: {resp.status_code}")
            logger.debug(f"  Response body: {resp.text[:500]}")
            
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed to create thread: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            thread_id = data.get("thread_id") or data.get("id")
            self._thread_cache[session_key] = thread_id
            logger.info(f"  Created thread: {thread_id}")
            return thread_id
        except Exception as e:
            logger.error(f"Error creating thread: {e}")
            raise
    
    async def send_message(
        self,
        session_key: str,
        content: str,
        system_prompt: str,
        memory: str = "Auto",
    ) -> str:
        """Send a message and get a response."""
        logger.info(f"send_message called for session: {session_key}")
        logger.debug(f"  Content length: {len(content)}")
        logger.debug(f"  Content preview: {content[:200]}...")
        
        if not self.is_configured:
            logger.error("Backboard API key not configured!")
            raise Exception("Backboard API key not configured")
        
        try:
            thread_id = await self._get_or_create_thread(session_key, system_prompt)
            url = f"{self.base_url}/threads/{thread_id}/messages"
            
            form_data = {
                "content": content,
                "stream": "false",
                "memory": memory,
                "model": self.model,
                "provider": self.provider,
            }
            
            logger.info(f"Sending message to {url}")
            logger.debug(f"  Form data: model={self.model}, provider={self.provider}, memory={memory}")
            
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(url, headers=self.headers, data=form_data)
            
            logger.info(f"  Response status: {resp.status_code}")
            
            if resp.status_code != 200:
                logger.error(f"  Response error: {resp.text}")
                raise Exception(f"Failed to send message: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            result = data.get("content") or data.get("text") or ""
            logger.info(f"  Response length: {len(result)}")
            logger.debug(f"  Response preview: {result[:200]}...")
            return result
            
        except Exception as e:
            logger.error(f"Error in send_message: {e}")
            raise
    
    async def one_shot(self, prompt: str, system_prompt: str) -> str:
        """Send a one-shot query without memory."""
        logger.info("one_shot called")
        logger.debug(f"  Prompt length: {len(prompt)}")
        
        if not self.is_configured:
            logger.error("Backboard API key not configured!")
            raise Exception("Backboard API key not configured")
        
        try:
            # Create fresh assistant and thread for one-shot
            url = f"{self.base_url}/assistants"
            payload = {
                "name": "Lightning Loop One-Shot",
                "system_prompt": system_prompt,
            }
            
            logger.info(f"Creating one-shot assistant at {url}")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=self.headers, json=payload)
            
            logger.info(f"  Response status: {resp.status_code}")
            
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed to create assistant: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            assistant_id = data.get("assistant_id") or data.get("id")
            logger.info(f"  Created assistant: {assistant_id}")
            
            # Create thread
            url = f"{self.base_url}/assistants/{assistant_id}/threads"
            logger.info(f"Creating thread at {url}")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=self.headers, json={})
            
            logger.info(f"  Response status: {resp.status_code}")
            
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed to create thread: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            thread_id = data.get("thread_id") or data.get("id")
            logger.info(f"  Created thread: {thread_id}")
            
            # Send message with memory off
            url = f"{self.base_url}/threads/{thread_id}/messages"
            form_data = {
                "content": prompt,
                "stream": "false",
                "memory": "off",
                "model": self.model,
                "provider": self.provider,
            }
            
            logger.info(f"Sending one-shot message to {url}")
            
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, headers=self.headers, data=form_data)
            
            logger.info(f"  Response status: {resp.status_code}")
            
            if resp.status_code != 200:
                logger.error(f"  Response error: {resp.text}")
                raise Exception(f"Failed to send message: {resp.status_code} - {resp.text}")
            
            data = resp.json()
            result = data.get("content") or data.get("text") or ""
            logger.info(f"  Response length: {len(result)}")
            return result
            
        except Exception as e:
            logger.error(f"Error in one_shot: {e}")
            raise


# Singleton instance
backboard = BackboardClient()
