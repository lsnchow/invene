# Backboard API — Extended Notes

This document consolidates and expands the Backboard API notes captured from the UI. It is intentionally verbose and meant as a detailed reference for understanding concepts, endpoints, request/response shapes, and operational behavior.

## Overview

Backboard API is designed to build conversational AI applications with persistent memory and intelligent document processing. It exposes a REST API with a clear separation of concepts: Assistants, Threads, Messages, Documents, Memories, and Models.

Key points at a glance:
- Base URL: `https://app.backboard.io/api`
- OpenAPI version: `OAS 3.1.0`
- API version shown in UI: `v1.0.0`
- Authentication: API Key via header `X-API-Key`
- Core flow: Assistant → Thread → Messages (with optional Documents and Memory)

## Authentication

Authentication is required for all endpoints.
- Auth type: API key in header
- Header name: `X-API-Key`
- Example header:
  - `X-API-Key: YOUR_SECRET_TOKEN`

The UI example shows a base64-looking value, but you should use your actual API key.

## Core Concepts

### Assistant

An Assistant is the configured AI agent that acts according to your instructions and settings. You create it once and use it across multiple conversations.

Key properties:
- `assistant_id`: Unique identifier
- `name`: Human-readable name
- `system_prompt`: System instructions that define behavior and personality
- `llm_provider`: AI provider (e.g., `openai`, `anthropic`, `google`)
- `model_name`: Specific model (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`)
- `tools`: Optional tools the assistant can use
- `embedding_provider` and `embedding_model_name`: Models used for RAG and memory operations

Typical use cases:
- Customer support bot with product knowledge
- Code review assistant with strict standards
- Research assistant with domain expertise

### Thread

A Thread is a persistent conversation session. Threads store full message history and are tied to a specific assistant.

Key properties:
- `thread_id`: Unique identifier for the conversation
- `assistant_id`: Which assistant owns the thread
- `messages`: Stored conversation history

Important behavioral notes:
- Threads persist indefinitely unless deleted
- Threads are tied to a specific assistant
- Multiple threads per assistant are supported
- Conversation history is maintained automatically

Example flow:
- Create Thread A
- Send messages in Thread A
- Days later, send another message to Thread A
- The assistant uses the stored history

### Message

A Message is a single exchange in a thread. Messages can be user input or assistant output, and can optionally trigger tool calls.

Key properties:
- `content`: Text content
- `role`: `user` or `assistant`
- `thread_id`: Thread it belongs to
- `stream`: Whether to stream the response
- `memory`: Memory mode controlling persistent memory usage

Streaming vs non-streaming:
- Non-streaming: response returned as a whole
- Streaming: response returned in chunks for realtime UX

### Document

Documents provide context to the assistant, either at the assistant level (shared across threads) or thread level (specific to one conversation).

Key properties:
- `document_id`
- `filename`
- `status`: `pending`, `processing`, `indexed`, `error`
- `assistant_id` or `thread_id`

Supported formats:
- PDF
- `.txt`, `.md`
- `.docx`, `.xlsx`, `.pptx`
- `.csv`, `.json`
- Source code files

Processing pipeline:
- Upload document via API
- Backboard chunks and indexes the content
- Status transitions from `processing` to `completed` or `indexed`
- Content becomes available for retrieval

### Memory

Memory is a feature for persistent knowledge. It can store and retrieve facts, preferences, and context across threads for the same assistant.

Memory modes:
- `off`: No persistent memory usage
- `Auto`: Enables memory search and automatic memory operations
- `Readonly`: Search memory but do not write

Behavior details:
- Extracts key facts automatically
- Stores facts in a semantic knowledge base
- Retrieves relevant memories in future messages
- Works across different threads of the same assistant

Example:
- Thread 1: User says, “I prefer Python over JavaScript”
- Thread 2: Assistant recalls this preference

## Typical Workflow

High-level flow:
1. Create an Assistant
2. Create a Thread for a user/session
3. Upload Documents (optional)
4. Send Messages
5. Use Memory (optional) with `memory="Auto"`

This workflow maps to the core features:
- Persistent conversations
- Intelligent document processing
- Customizable assistants

## Quickstart (Python)

```python
import requests

API_KEY = "your_api_key"
BASE_URL = "https://app.backboard.io/api"
HEADERS = {"X-API-Key": API_KEY}

# 1) Create assistant
response = requests.post(
    f"{BASE_URL}/assistants",
    json={"name": "Support Bot", "system_prompt": "After every response, pass a joke at the end of the response!"},
    headers=HEADERS,
)
assistant_id = response.json()["assistant_id"]

# 2) Create thread
response = requests.post(
    f"{BASE_URL}/assistants/{assistant_id}/threads",
    json={},
    headers=HEADERS,
)
thread_id = response.json()["thread_id"]

# 3) Send message
response = requests.post(
    f"{BASE_URL}/threads/{thread_id}/messages",
    headers=HEADERS,
    data={"content": "Tell me about Canada in detail.", "stream": "false", "memory": "Auto"},
)
print(response.json().get("content"))
```

## Threads Endpoints

### List Threads

Endpoint:
- `GET /threads`

Description:
- List all threads for the authenticated user.

Query parameters:
- `skip`: integer, default `0`
- `limit`: integer, default `100`

Sample request:
```python
requests.get("https://app.backboard.io/api/threads",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
[
  {
    "metadata_": {"additionalProperty": "anything"},
    "thread_id": "123e4567-e89b-12d3-a456-426614174000",
    "created_at": "2026-02-05T02:15:37.795Z",
    "messages": []
  }
]
```

### Get Thread

Endpoint:
- `GET /threads/{thread_id}`

Description:
- Retrieve a specific thread by UUID, including its messages.

Path parameters:
- `thread_id` (uuid)

Sample request:
```python
requests.get(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
{
  "metadata_": {"additionalProperty": "anything"},
  "thread_id": "123e4567-e89b-12d3-a456-426614174000",
  "created_at": "2026-02-05T02:15:37.795Z",
  "messages": []
}
```

### Delete Thread

Endpoint:
- `DELETE /threads/{thread_id}`

Description:
- Permanently delete a thread and all associated messages.

Path parameters:
- `thread_id` (uuid)

Sample request:
```python
requests.delete(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
{
  "message": "string",
  "thread_id": "123e4567-e89b-12d3-a456-426614174000",
  "deleted_at": "2026-02-05T02:15:37.795Z"
}
```

### List Thread Documents

Endpoint:
- `GET /threads/{thread_id}/documents`

Description:
- List all documents associated with a thread.

Path parameters:
- `thread_id` (uuid)

Sample request:
```python
requests.get(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000/documents",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
[
  {
    "metadata_": {"additionalProperty": "anything"},
    "document_id": "123e4567-e89b-12d3-a456-426614174000",
    "filename": "string",
    "status": "pending",
    "status_message": "string",
    "summary": "string",
    "created_at": "2026-02-05T02:15:37.795Z",
    "updated_at": "2026-02-05T02:15:37.795Z"
  }
]
```

### Add Message to Thread (with Optional Attachments)

Endpoint:
- `POST /threads/{thread_id}/messages`

Description:
- Add a user message to an existing thread.
- Accepts text, file attachments, or both.
- Documents must be indexed before further messages are allowed.
- If `llm_provider` and `model_name` are omitted, defaults are `openai` and `gpt-4o`.
- `memory="Auto"` enables memory search and automatic memory operations.
- Web search is controlled by `web_search`.

Body (multipart/form-data):
- `content`: string or null
- `files`: array of files
- `llm_provider`: string or null (default `openai`)
- `model_name`: string or null (default `gpt-4o`)
- `stream`: boolean or string (`false`)
- `memory`: `Auto`, `off`, `Readonly` (default `off`)
- `web_search`: `Auto` or `off` (default `off`)
- `send_to_llm`: `true` or `false` (default `true`)
- `metadata`: JSON string

Sample request:
```python
requests.post(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000/messages",
    headers={
      "Content-Type": "multipart/form-data",
      "X-API-Key": "YOUR_SECRET_TOKEN"
    },
    data={
      "content": "",
      "llm_provider": "",
      "model_name": "",
      "stream": "false",
      "memory": "off",
      "web_search": "off",
      "send_to_llm": "true",
      "metadata": ""
    }
)
```

Sample response (200):
```json
{
  "message": "string",
  "thread_id": "123e4567-e89b-12d3-a456-426614174000",
  "content": "string",
  "message_id": "123e4567-e89b-12d3-a456-426614174000",
  "role": "user",
  "status": "IN_PROGRESS",
  "tool_calls": [
    {"additionalProperty": "anything"}
  ],
  "run_id": "string",
  "memory_operation_id": "string",
  "retrieved_memories": [
    {"id": "string", "memory": "string", "score": 1}
  ],
  "retrieved_files": ["string"],
  "model_provider": "string",
  "model_name": "string",
  "input_tokens": 1,
  "output_tokens": 1,
  "total_tokens": 1,
  "created_at": "2026-02-05T02:15:37.795Z",
  "attachments": [
    {
      "document_id": "123e4567-e89b-12d3-a456-426614174000",
      "filename": "string",
      "status": "string",
      "file_size_bytes": 1,
      "summary": "string"
    }
  ],
  "timestamp": "2026-02-05T02:15:37.795Z"
}
```

### Submit Tool Outputs for a Run

Endpoint:
- `POST /threads/{thread_id}/runs/{run_id}/submit-tool-outputs`

Description:
- Submit outputs for tool calls requested by an assistant.
- Continues the run after tool outputs are provided.
- Supports streaming via `stream=true` query parameter.

Path parameters:
- `thread_id` (uuid)
- `run_id` (string)

Query parameters:
- `stream`: boolean, default `false`

Body (application/json):
- `tool_outputs`: array of `{ tool_call_id, output }`

Sample request:
```python
requests.post(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000/runs/{run_id}/submit-tool-outputs",
    headers={
      "Content-Type": "application/json",
      "X-API-Key": "YOUR_SECRET_TOKEN"
    },
    json={
      "tool_outputs": [
        {"tool_call_id": "", "output": ""}
      ]
    }
)
```

Sample response (200):
```json
{
  "message": "string",
  "thread_id": "123e4567-e89b-12d3-a456-426614174000",
  "run_id": "string",
  "content": "string",
  "message_id": "123e4567-e89b-12d3-a456-426614174000",
  "role": "user",
  "status": "IN_PROGRESS",
  "tool_calls": [
    {"additionalProperty": "anything"}
  ],
  "memory_operation_id": "string",
  "retrieved_memories": [
    {"id": "string", "memory": "string", "score": 1}
  ],
  "retrieved_files": ["string"],
  "model_provider": "string",
  "model_name": "string",
  "input_tokens": 1,
  "output_tokens": 1,
  "total_tokens": 1,
  "created_at": "2026-02-05T02:15:37.795Z",
  "timestamp": "2026-02-05T02:15:37.795Z"
}
```

## Documents Endpoints

### Upload Document to Thread

Endpoint:
- `POST /threads/{thread_id}/documents`

Description:
- Upload a document and associate it with a specific thread.
- Document is processed for RAG.

Path parameters:
- `thread_id` (uuid)

Body (multipart/form-data):
- `file`: binary file data

Sample request:
```python
requests.post(
    "https://app.backboard.io/api/threads/123e4567-e89b-12d3-a456-426614174000/documents",
    headers={
      "Content-Type": "multipart/form-data",
      "X-API-Key": "YOUR_SECRET_TOKEN"
    },
    data={"file": "@filename"}
)
```

Sample response (200):
```json
{
  "metadata_": {"additionalProperty": "anything"},
  "document_id": "123e4567-e89b-12d3-a456-426614174000",
  "filename": "string",
  "status": "pending",
  "status_message": "string",
  "summary": "string",
  "created_at": "2026-02-05T02:15:37.795Z",
  "updated_at": "2026-02-05T02:15:37.795Z"
}
```

### Delete Document

Endpoint:
- `DELETE /documents/{document_id}`

Description:
- Delete a document by ID across assistant, thread, or message scope.

Path parameters:
- `document_id` (uuid)

Sample request:
```python
requests.delete(
    "https://app.backboard.io/api/documents/{document_id}",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
{
  "message": "string",
  "document_id": "123e4567-e89b-12d3-a456-426614174000",
  "filename": "string",
  "document_type": "string",
  "deleted_at": "2026-02-05T02:15:37.795Z"
}
```

### Get Document Status

Endpoint:
- `GET /documents/{document_id}/status`

Description:
- Retrieve processing status and metadata about a document.

Path parameters:
- `document_id` (uuid)

Sample request:
```python
requests.get(
    "https://app.backboard.io/api/documents/{document_id}/status",
    headers={"X-API-Key": "YOUR_SECRET_TOKEN"}
)
```

Sample response (200):
```json
{
  "document_id": "123e4567-e89b-12d3-a456-426614174000",
  "filename": "string",
  "document_type": "string",
  "status": "string",
  "status_message": "string",
  "file_size_bytes": 1,
  "total_tokens": 1,
  "chunk_count": 1,
  "processing_started_at": "2026-02-05T02:15:37.795Z",
  "processing_completed_at": "2026-02-05T02:15:37.795Z",
  "created_at": "2026-02-05T02:15:37.795Z",
  "updated_at": "2026-02-05T02:15:37.795Z"
}
```

## Assistants Endpoints (Summary)

The UI lists these operations:
- `POST /assistants`
- `GET /assistants`
- `GET /assistants/{assistant_id}`
- `PUT /assistants/{assistant_id}`
- `DELETE /assistants/{assistant_id}`
- `POST /assistants/{assistant_id}/threads`
- `GET /assistants/{assistant_id}/threads`
- `GET /assistants/{assistant_id}/documents`
- `POST /assistants/{assistant_id}/documents`

This doc does not include the full parameter/response schemas for these endpoints, but the names indicate standard CRUD operations for Assistants, plus thread/document listing and creation at the assistant scope.

## Memories Endpoints

### Get All Memories

Endpoint:
- `GET /assistants/{assistant_id}/memories`

Description:
- List all memories for a specific assistant.

Sample response (200):
```json
{
  "memories": [],
  "total_count": 0
}
```

### Add Memory

Endpoint:
- `POST /assistants/{assistant_id}/memories`

Description:
- Create a memory record manually.

Body (application/json):
- `content`: string (required)
- `metadata`: object (optional)

Sample response (201):
```json
{
  "additionalProperty": "anything"
}
```

### Get Memory by ID

Endpoint:
- `GET /assistants/{assistant_id}/memories/{memory_id}`

Sample response (200):
```json
{
  "id": "string",
  "content": "string",
  "metadata": {"additionalProperty": "anything"},
  "score": 1,
  "created_at": "string",
  "updated_at": "string"
}
```

### Delete Memory

Endpoint:
- `DELETE /assistants/{assistant_id}/memories/{memory_id}`

Sample response (200):
```json
{
  "success": true,
  "message": "string"
}
```

### Update Memory

Endpoint:
- `PUT /assistants/{assistant_id}/memories/{memory_id}`

Body (application/json):
- `content`: string (required)
- `metadata`: object (optional)

Sample response (200):
```json
{
  "id": "string",
  "content": "string",
  "metadata": {"additionalProperty": "anything"},
  "score": 1,
  "created_at": "string",
  "updated_at": "string"
}
```

### Get Memory Stats

Endpoint:
- `GET /assistants/{assistant_id}/memories/stats`

Sample response (200):
```json
{
  "additionalProperty": "anything"
}
```

### Get Memory Operation Status

Endpoint:
- `GET /assistants/memories/operations/{operation_id}`

Sample response (200):
```json
{
  "operation_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "string",
  "memory_ids": [],
  "result_count": 1,
  "created_at": "2026-02-05T02:15:37.795Z",
  "updated_at": "2026-02-05T02:15:37.795Z"
}
```

## Models Endpoints

### List All Models

Endpoint:
- `GET /models`

Description:
- List available models and their specs (excluding pricing).

Query parameters:
- `model_type`: `llm` or `embedding`
- `provider`: provider name
- `supports_tools`: filter by tool-calling support
- `min_context` and `max_context`: filter by context window
- `skip`: default `0`
- `limit`: default `100`, max `500`

Sample response (200):
```json
{
  "models": [
    {
      "name": "string",
      "provider": "string",
      "model_type": "string",
      "context_limit": 1,
      "max_output_tokens": 1,
      "supports_tools": true,
      "api_mode": "string",
      "embedding_dimensions": 1,
      "last_updated": "2026-02-05T02:15:37.795Z"
    }
  ],
  "total": 1
}
```

### List All Providers

Endpoint:
- `GET /models/providers`

Sample response (200):
```json
{
  "providers": ["string"],
  "total": 1
}
```

### List Models by Provider

Endpoint:
- `GET /models/provider/{provider_name}`

Query parameters:
- `skip` and `limit` as in list models

Sample response (200):
```json
{
  "models": [
    {
      "name": "string",
      "provider": "string",
      "model_type": "string",
      "context_limit": 1,
      "max_output_tokens": 1,
      "supports_tools": true,
      "api_mode": "string",
      "embedding_dimensions": 1,
      "last_updated": "2026-02-05T02:15:37.795Z"
    }
  ],
  "total": 1
}
```

### Get Model by Name

Endpoint:
- `GET /models/{model_name}`

Sample response (200):
```json
{
  "name": "string",
  "provider": "string",
  "model_type": "string",
  "context_limit": 1,
  "max_output_tokens": 1,
  "supports_tools": true,
  "api_mode": "string",
  "embedding_dimensions": 1,
  "last_updated": "2026-02-05T02:15:37.795Z"
}
```

### List All Embedding Models

Endpoint:
- `GET /models/embedding/all`

Query parameters:
- `provider`
- `min_dimensions`
- `max_dimensions`
- `skip` and `limit`

Sample response (200):
```json
{
  "models": [
    {
      "name": "string",
      "provider": "string",
      "embedding_dimensions": 1,
      "context_limit": 1,
      "last_updated": "2026-02-05T02:15:37.795Z"
    }
  ],
  "total": 1
}
```

### List All Embedding Model Providers

Endpoint:
- `GET /models/embedding/providers`

Sample response (200):
```json
{
  "providers": ["string"],
  "total": 1
}
```

### Get Embedding Model by Name

Endpoint:
- `GET /models/embedding/{model_name}`

Sample response (200):
```json
{
  "name": "string",
  "provider": "string",
  "embedding_dimensions": 1,
  "context_limit": 1,
  "last_updated": "2026-02-05T02:15:37.795Z"
}
```

## Notes and Observations

- Many examples show timestamps around `2026-02-05T02:15:37.795Z`, which appears to be sample data.
- The Threads `POST /threads/{thread_id}/messages` endpoint is the main entry point for sending user messages and optionally attaching files.
- Document status workflow is important; messages cannot continue while documents are still indexing.
- Memory features are optional and controlled per message with `memory`.
- The model endpoints expose availability and metadata, which is helpful for dynamic model selection.

## Glossary

- RAG: Retrieval-Augmented Generation, uses document embeddings to retrieve relevant context.
- LLM: Large Language Model.
- Thread: Persistent conversation log tied to an assistant.
- Memory: Long-term knowledge store for an assistant.

