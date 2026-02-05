"""
PDF ingestion API - upload, extract text, generate summary.
"""
import uuid
import io
import logging
from typing import Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])

# In-memory document store for demo
# In production, use a proper storage solution
_document_store: dict = {}


class DocumentResponse(BaseModel):
    doc_id: str
    filename: str
    extracted_summary: str
    page_count: int
    chunk_refs: Optional[list] = None


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]


def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, int]:
    """
    Extract text from PDF bytes.
    Returns (text, page_count).
    
    For demo, we use a simple approach. In production, use pdf2text, PyPDF2, or similar.
    """
    try:
        # Try to import PyPDF2
        import PyPDF2
        
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
        
        return "\n\n".join(pages), len(reader.pages)
        
    except ImportError:
        # PyPDF2 not installed, return placeholder
        logger.warning("PyPDF2 not installed, returning placeholder text")
        return "[PDF text extraction requires PyPDF2. Install with: pip install PyPDF2]", 1
    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return f"[Failed to extract text: {e}]", 0


def generate_summary(text: str, max_length: int = 500) -> str:
    """
    Generate a summary of the extracted text.
    For demo, we just take the first N characters.
    In production, use LLM summarization.
    """
    if len(text) <= max_length:
        return text
    
    # Take first part and last part
    half = max_length // 2
    summary = text[:half] + "\n...\n" + text[-half:]
    return summary


def extract_key_requirements(text: str) -> list[str]:
    """
    Extract key requirements/constraints from text.
    Simple heuristic: look for lines starting with bullets, numbers, or keywords.
    """
    requirements = []
    keywords = ["must", "should", "require", "need", "constraint", "limit"]
    
    lines = text.split("\n")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Check for bullets or numbers
        if line.startswith(("-", "•", "*", "1", "2", "3", "4", "5", "6", "7", "8", "9")):
            if len(line) > 10 and len(line) < 200:
                requirements.append(line)
                continue
        
        # Check for keywords
        lower_line = line.lower()
        for kw in keywords:
            if kw in lower_line and len(line) < 200:
                requirements.append(line)
                break
        
        if len(requirements) >= 10:
            break
    
    return requirements


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a PDF document, extract text, and generate summary.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    # Read file
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    
    # Generate doc ID
    doc_id = f"doc-{uuid.uuid4().hex[:8]}"
    
    # Extract text
    text, page_count = extract_text_from_pdf(contents)
    
    # Generate summary
    summary = generate_summary(text)
    
    # Extract key requirements
    requirements = extract_key_requirements(text)
    
    # Store document
    _document_store[doc_id] = {
        "doc_id": doc_id,
        "filename": file.filename,
        "text": text,
        "summary": summary,
        "requirements": requirements,
        "page_count": page_count,
    }
    
    logger.info(f"Uploaded document {doc_id}: {file.filename} ({page_count} pages)")
    
    return DocumentResponse(
        doc_id=doc_id,
        filename=file.filename,
        extracted_summary=summary,
        page_count=page_count,
        chunk_refs=requirements if requirements else None,
    )


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str):
    """Get document metadata by ID."""
    doc = _document_store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return DocumentResponse(
        doc_id=doc["doc_id"],
        filename=doc["filename"],
        extracted_summary=doc["summary"],
        page_count=doc["page_count"],
        chunk_refs=doc.get("requirements"),
    )


@router.get("/{doc_id}/text")
async def get_document_text(doc_id: str):
    """Get full extracted text for a document."""
    doc = _document_store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {"doc_id": doc_id, "text": doc["text"]}


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    """Delete a document."""
    if doc_id not in _document_store:
        raise HTTPException(status_code=404, detail="Document not found")
    
    del _document_store[doc_id]
    logger.info(f"Deleted document {doc_id}")
    
    return {"status": "deleted", "doc_id": doc_id}


@router.get("/", response_model=DocumentListResponse)
async def list_documents():
    """List all uploaded documents."""
    docs = [
        DocumentResponse(
            doc_id=doc["doc_id"],
            filename=doc["filename"],
            extracted_summary=doc["summary"],
            page_count=doc["page_count"],
            chunk_refs=doc.get("requirements"),
        )
        for doc in _document_store.values()
    ]
    return DocumentListResponse(documents=docs)
