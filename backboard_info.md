# Backboard API Integration Guide

A comprehensive guide to integrating the Backboard API into your project for AI-powered chat, assistants, and LLM interactions.

## Table of Contents
- [Overview](#overview)
- [Getting Started](#getting-started)
- [Core Concepts](#core-concepts)
- [API Endpoints](#api-endpoints)
- [Implementation Patterns](#implementation-patterns)
- [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [Tips & Tricks](#tips-and-tricks)
- [Common Pitfalls](#common-pitfalls)

---

## Overview

**Backboard** is an API service that provides LLM capabilities through a structured assistant/thread/message architecture. It's ideal for:
- Building conversational AI agents
- Creating persistent chat threads
- Implementing multi-turn conversations with context
- Running LLM inference with custom system prompts
- Managing conversation memory and history

**Base URL**: `https://app.backboard.io/api`

**Authentication**: API Key via `X-API-Key` header

---

## Getting Started

### 1. Configuration

Set up your environment variables:

```bash
export BACKBOARD_API_KEY="your_api_key_here"
export BACKBOARD_BASE_URL="https://app.backboard.io/api"
```

### 2. Basic Client Setup

```python
import httpx
from typing import Optional

class BackboardClient:
    def __init__(self, api_key: str, base_url: str = "https://app.backboard.io/api"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "X-API-Key": self.api_key,
            "Accept": "application/json",
        }
```

### 3. Required Dependencies

```bash
pip install httpx  # For async HTTP requests
```

---

## Core Concepts

### The Three-Layer Architecture

Backboard uses a hierarchical structure:

```
Assistant (System Prompt)
    ├── Thread 1 (Conversation)
    │   ├── Message 1
    │   ├── Message 2
    │   └── Message 3
    ├── Thread 2 (Conversation)
    │   ├── Message 1
    │   └── Message 2
```

1. **Assistant**: An AI agent with a specific system prompt and personality
2. **Thread**: A conversation context (maintains message history)
3. **Message**: Individual user/assistant exchanges within a thread

---

## API Endpoints

### 1. Create Assistant

**Purpose**: Define an AI assistant with a custom system prompt

```
POST /assistants
Content-Type: application/json
```

**Request Body**:
```json
{
  "name": "My Assistant Name",
  "system_prompt": "You are a helpful assistant that..."
}
```

**Response**:
```json
{
  "assistant_id": "asst_abc123",
  "id": "asst_abc123",
  "name": "My Assistant Name"
}
```

**Python Example**:
```python
async def create_assistant(self, name: str, system_prompt: str) -> str:
    url = f"{self.base_url}/assistants"
    payload = {"name": name, "system_prompt": system_prompt}
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, headers=self.headers, json=payload)
    
    if resp.status_code not in (200, 201):
        raise Exception(f"Failed: {resp.status_code} - {resp.text}")
    
    data = resp.json()
    return data.get("assistant_id") or data.get("id")
```

---

### 2. Create Thread

**Purpose**: Start a new conversation context for an assistant

```
POST /assistants/{assistant_id}/threads
Content-Type: application/json
```

**Request Body**:
```json
{}
```

⚠️ **CRITICAL**: Must send an empty JSON object `{}` - omitting the body causes 422 errors!

**Response**:
```json
{
  "thread_id": "thread_xyz789",
  "id": "thread_xyz789"
}
```

**Python Example**:
```python
async def create_thread(self, assistant_id: str) -> str:
    url = f"{self.base_url}/assistants/{assistant_id}/threads"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # MUST send json={} - empty body causes 422!
        resp = await client.post(url, headers=self.headers, json={})
    
    if resp.status_code not in (200, 201):
        raise Exception(f"Failed: {resp.status_code} - {resp.text}")
    
    data = resp.json()
    return data.get("thread_id") or data.get("id")
```

---

### 3. Send Message

**Purpose**: Send a message to a thread and get AI response

```
POST /threads/{thread_id}/messages
Content-Type: application/x-www-form-urlencoded
```

⚠️ **CRITICAL**: This endpoint uses **FORM DATA**, not JSON!

**Form Data Parameters**:
- `content` (required): The message text
- `stream` (required): `"false"` (string, not boolean)
- `memory` (required): `"Auto"` or `"off"`
- `model` (optional): Model identifier (e.g., `"amazon/nova-micro-v1"`)
- `provider` (optional): Provider name (e.g., `"amazon"`)

**Response**:
```json
{
  "content": "The assistant's response text",
  "text": "Alternative response field"
}
```

**Python Example**:
```python
async def send_message(
    self,
    thread_id: str,
    content: str,
    model: str = "amazon/nova-micro-v1",
    provider: str = "amazon"
) -> str:
    url = f"{self.base_url}/threads/{thread_id}/messages"
    
    # FORM DATA - not JSON!
    form_data = {
        "content": content,
        "stream": "false",  # String, not boolean
        "memory": "Auto",
        "model": model,
        "provider": provider,
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, headers=self.headers, data=form_data)
    
    if resp.status_code != 200:
        raise Exception(f"Failed: {resp.status_code} - {resp.text}")
    
    data = resp.json()
    # Response may use 'content' or 'text' field
    return data.get("content") or data.get("text")
```

---

## Implementation Patterns

### Pattern 1: One-Shot Query (No Memory)

Use when you don't need conversation history:

```python
async def one_shot_query(prompt: str, system_prompt: str) -> str:
    client = BackboardClient(api_key="your_key")
    
    # Create assistant
    assistant_id = await client.create_assistant(
        name="One-Shot Assistant",
        system_prompt=system_prompt
    )
    
    # Create thread
    thread_id = await client.create_thread(assistant_id)
    
    # Send message with memory off
    response = await client.send_message(thread_id, prompt, memory="off")
    
    return response
```

---

### Pattern 2: Persistent Conversation (With Memory)

Use for multi-turn conversations:

```python
class ConversationManager:
    def __init__(self, api_key: str):
        self.client = BackboardClient(api_key)
        self.assistant_id = None
        self.thread_cache = {}
    
    async def ensure_assistant(self, system_prompt: str) -> str:
        if not self.assistant_id:
            self.assistant_id = await self.client.create_assistant(
                name="Persistent Assistant",
                system_prompt=system_prompt
            )
        return self.assistant_id
    
    async def chat(self, session_key: str, message: str) -> str:
        # Get or create thread for this session
        if session_key not in self.thread_cache:
            assistant_id = await self.ensure_assistant("Your system prompt...")
            thread_id = await self.client.create_thread(assistant_id)
            self.thread_cache[session_key] = thread_id
        
        thread_id = self.thread_cache[session_key]
        
        # Send message with memory enabled
        response = await self.client.send_message(
            thread_id,
            message,
            memory="Auto"
        )
        
        return response
```

---

### Pattern 3: Assistant Reuse

Reuse the same assistant across multiple threads:

```python
class AssistantPool:
    def __init__(self, api_key: str):
        self.client = BackboardClient(api_key)
        self.assistants = {}  # Cache by system prompt hash
    
    async def get_assistant(self, name: str, system_prompt: str) -> str:
        key = hash(system_prompt)
        
        if key not in self.assistants:
            assistant_id = await self.client.create_assistant(name, system_prompt)
            self.assistants[key] = assistant_id
        
        return self.assistants[key]
    
    async def new_conversation(self, system_prompt: str) -> str:
        assistant_id = await self.get_assistant("Reusable", system_prompt)
        return await self.client.create_thread(assistant_id)
```

---

## Best Practices

### 1. Timeout Configuration

Always set appropriate timeouts:

```python
async with httpx.AsyncClient(timeout=60.0) as client:  # 60 seconds for LLM calls
    # Create assistant: 30s
    # Create thread: 30s
    # Send message: 60s (LLM generation can be slow)
```

### 2. Response Field Flexibility

Backboard may return responses in different fields:

```python
# Handle multiple possible response fields
message = (
    result.get("content") or
    result.get("text") or
    result.get("message", {}).get("text") or
    result.get("message", {}).get("content", "")
)
```

### 3. Empty Content Validation

Always validate before sending:

```python
if not content or not content.strip():
    raise ValueError("Message content cannot be empty")
```

### 4. Session Key Design

Use meaningful session keys for thread caching:

```python
# Good: Unique per user/scenario
thread_key = f"user_{user_id}_scenario_{scenario_id}"

# Bad: Global singleton
thread_key = "main_thread"
```

### 5. Structured Output Parsing

When expecting JSON responses from the LLM:

```python
def extract_json(response: str) -> dict:
    """Extract JSON from markdown code blocks or inline"""
    
    # Try markdown code block
    if "```json" in response:
        json_str = response.split("```json")[1].split("```")[0]
    elif "```" in response:
        json_str = response.split("```")[1].split("```")[0]
    else:
        # Try finding inline JSON
        start = response.index("{")
        end = response.rindex("}") + 1
        json_str = response[start:end]
    
    return json.loads(json_str.strip())
```

---

## Error Handling

### Error Types and Recovery

```python
class BackboardError(Exception):
    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body
        super().__init__(f"Backboard error ({status}): {body}")

async def robust_api_call():
    try:
        response = await send_message(thread_id, content)
        return response
        
    except httpx.TimeoutException:
        # Network timeout - retry with exponential backoff
        logger.error("Request timed out")
        raise BackboardError(408, "Request timeout")
        
    except httpx.RequestError as e:
        # Connection error - check network/API status
        logger.error(f"Connection failed: {e}")
        raise BackboardError(0, f"Connection failed: {e}")
        
    except json.JSONDecodeError as e:
        # Malformed response - log for debugging
        logger.error(f"Invalid JSON response: {e}")
        raise BackboardError(500, "Invalid response format")
```

### Retry Strategy

```python
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
async def send_message_with_retry(thread_id: str, content: str) -> str:
    return await client.send_message(thread_id, content)
```

---

## Tips and Tricks

### 1. Prompt Engineering for JSON Output

When you need structured responses:

```python
PARSING_PROMPT = """Parse this input and respond with JSON only:

Input: {user_input}

Respond with exactly this structure (no extra text):
{{
  "field1": "value",
  "field2": 123,
  "field3": ["list", "of", "items"]
}}
"""
```

### 2. Context Injection

Add dynamic context to your messages:

```python
async def contextualized_message(
    thread_id: str,
    user_message: str,
    context: dict
) -> str:
    full_message = user_message
    
    if context.get("simulation_results"):
        full_message += f"\n\n[CONTEXT: approval={context['simulation_results'].get('approval')}]"
    
    if context.get("user_preferences"):
        full_message += f"\n[USER PREFERENCES: {context['user_preferences']}]"
    
    return await client.send_message(thread_id, full_message)
```

### 3. Model Selection

Choose models based on your use case:

```python
# Fast, cheap for simple tasks
MODEL_FAST = "amazon/nova-micro-v1"

# Better reasoning for complex tasks
MODEL_SMART = "anthropic/claude-3-haiku"

# Balance speed and quality
MODEL_BALANCED = "gemini-2.0-flash-lite-001"
```

### 4. Token Estimation

Rough token estimation for logging/metrics:

```python
def estimate_tokens(text: str) -> int:
    """Rough estimate: 1 token ≈ 4 characters"""
    return len(text) // 4

input_tokens = estimate_tokens(prompt)
output_tokens = estimate_tokens(response)
total_tokens = input_tokens + output_tokens
```

### 5. Memory Management

Control conversation memory strategically:

```python
# Use Auto for natural conversations
memory = "Auto"  # Backboard manages context automatically

# Use off for independent queries
memory = "off"  # Each message is standalone (cheaper, faster)
```

### 6. Logging and Observability

Implement comprehensive logging:

```python
import time
import logging

logger = logging.getLogger(__name__)

async def logged_send_message(thread_id: str, content: str) -> str:
    start_time = time.time()
    input_length = len(content)
    
    logger.info(
        f"→ BACKBOARD_SEND | thread={thread_id} | "
        f"input_length={input_length} chars | "
        f"input_tokens_est={input_length // 4}"
    )
    
    try:
        response = await client.send_message(thread_id, content)
        duration = time.time() - start_time
        output_length = len(response)
        
        logger.info(
            f"✓ BACKBOARD_SUCCESS | thread={thread_id} | "
            f"output_length={output_length} chars | "
            f"duration={duration:.3f}s | "
            f"tokens_per_sec={(input_length + output_length) // 4 / duration:.0f}"
        )
        
        return response
        
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"✗ BACKBOARD_FAILED | thread={thread_id} | error={e} | duration={duration:.3f}s")
        raise
```

### 7. Thread Cleanup

Implement cleanup for completed conversations:

```python
async def cleanup_old_threads(self, max_age_hours: int = 24):
    """Remove threads older than max_age_hours"""
    current_time = time.time()
    
    for session_key, (thread_id, created_at) in list(self.thread_cache.items()):
        age_hours = (current_time - created_at) / 3600
        
        if age_hours > max_age_hours:
            try:
                await self.delete_thread(thread_id)
                del self.thread_cache[session_key]
                logger.info(f"Cleaned up thread {thread_id} (age: {age_hours:.1f}h)")
            except Exception as e:
                logger.warning(f"Failed to cleanup thread {thread_id}: {e}")
```

---

## Common Pitfalls

### ❌ Pitfall 1: Using JSON for Thread Creation

```python
# WRONG - Returns 422 error
resp = await client.post(url, headers=self.headers)

# CORRECT - Must send empty JSON object
resp = await client.post(url, headers=self.headers, json={})
```

### ❌ Pitfall 2: Using JSON for Message Sending

```python
# WRONG - Backboard expects form data
resp = await client.post(url, headers=self.headers, json={"content": message})

# CORRECT - Use data parameter for form encoding
resp = await client.post(url, headers=self.headers, data={"content": message})
```

### ❌ Pitfall 3: Boolean Stream Parameter

```python
# WRONG - Boolean type
form_data = {"stream": False}

# CORRECT - String type
form_data = {"stream": "false"}
```

### ❌ Pitfall 4: Missing API Key Check

```python
# WRONG - Silent failure
if not self.api_key:
    self.api_key = "fallback_key"

# CORRECT - Explicit error
if not self.api_key:
    raise ValueError("BACKBOARD_API_KEY not configured")
```

### ❌ Pitfall 5: Assuming Response Field

```python
# WRONG - May fail if field doesn't exist
message = response["content"]

# CORRECT - Handle multiple possible fields
message = response.get("content") or response.get("text") or ""
```

### ❌ Pitfall 6: No Input Validation

```python
# WRONG - Allows empty messages
await send_message(thread_id, "")

# CORRECT - Validate before sending
if not content or not content.strip():
    raise ValueError("Content cannot be empty")
await send_message(thread_id, content)
```

### ❌ Pitfall 7: Creating New Assistant Every Time

```python
# WRONG - Wasteful, creates many duplicate assistants
async def query(prompt):
    assistant_id = await create_assistant("Helper", SYSTEM_PROMPT)
    thread_id = await create_thread(assistant_id)
    return await send_message(thread_id, prompt)

# CORRECT - Reuse assistant across calls
class Client:
    async def ensure_assistant(self):
        if not self._assistant_id:
            self._assistant_id = await self.create_assistant("Helper", SYSTEM_PROMPT)
        return self._assistant_id
```

---

## Complete Example

Here's a full working example putting it all together:

```python
import httpx
import asyncio
from typing import Optional

class BackboardClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://app.backboard.io/api"
        self.headers = {
            "X-API-Key": self.api_key,
            "Accept": "application/json",
        }
        self._assistant_id: Optional[str] = None
        self._thread_cache: dict[str, str] = {}
    
    async def create_assistant(self, name: str, system_prompt: str) -> str:
        url = f"{self.base_url}/assistants"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers=self.headers,
                json={"name": name, "system_prompt": system_prompt}
            )
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed: {resp.text}")
            data = resp.json()
            return data.get("assistant_id") or data.get("id")
    
    async def create_thread(self, assistant_id: str) -> str:
        url = f"{self.base_url}/assistants/{assistant_id}/threads"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers=self.headers,
                json={}  # MUST send empty JSON
            )
            if resp.status_code not in (200, 201):
                raise Exception(f"Failed: {resp.text}")
            data = resp.json()
            return data.get("thread_id") or data.get("id")
    
    async def send_message(self, thread_id: str, content: str) -> str:
        if not content or not content.strip():
            raise ValueError("Content cannot be empty")
        
        url = f"{self.base_url}/threads/{thread_id}/messages"
        form_data = {
            "content": content,
            "stream": "false",
            "memory": "Auto",
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers=self.headers,
                data=form_data  # Form data, not JSON
            )
            if resp.status_code != 200:
                raise Exception(f"Failed: {resp.text}")
            data = resp.json()
            return data.get("content") or data.get("text")
    
    async def ensure_assistant(self) -> str:
        if not self._assistant_id:
            self._assistant_id = await self.create_assistant(
                "My Assistant",
                "You are a helpful assistant."
            )
        return self._assistant_id
    
    async def chat(self, session_key: str, message: str) -> str:
        assistant_id = await self.ensure_assistant()
        
        if session_key not in self._thread_cache:
            thread_id = await self.create_thread(assistant_id)
            self._thread_cache[session_key] = thread_id
        
        thread_id = self._thread_cache[session_key]
        return await self.send_message(thread_id, message)

# Usage
async def main():
    client = BackboardClient(api_key="your_api_key")
    
    # Single conversation
    response1 = await client.chat("user_123", "Hello, what's your name?")
    print(response1)
    
    response2 = await client.chat("user_123", "What did I just ask you?")
    print(response2)  # Should remember previous context

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Additional Resources

- **API Documentation**: Check with Backboard for official API docs
- **Model Options**: Consult your provider for available models and pricing
- **Rate Limits**: Monitor your usage and implement rate limiting if needed
- **Security**: Never commit API keys to version control - use environment variables

---

## Summary Checklist

✅ **Setup**
- [ ] API key configured in environment variables
- [ ] HTTP client with proper timeouts
- [ ] Headers include X-API-Key and Accept

✅ **Implementation**
- [ ] Create assistant with system prompt
- [ ] Create thread with `json={}` (not empty body)
- [ ] Send messages with `data=` (form data, not JSON)
- [ ] Handle both `content` and `text` response fields
- [ ] Validate input before sending
- [ ] Cache assistants and threads appropriately

✅ **Production**
- [ ] Error handling with proper exceptions
- [ ] Retry logic for transient failures
- [ ] Logging for observability
- [ ] Thread cleanup for long-running systems
- [ ] Model selection strategy
- [ ] Memory management strategy

---

**Happy Building! 🚀**

This guide should help you integrate Backboard into any project. Remember: the key to success is understanding the three-layer architecture (assistant/thread/message) and being careful about JSON vs. form data encoding.
