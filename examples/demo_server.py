from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from datetime import date
import threading
import sys
import os

# Allow running from the repo root without installing the package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from docbuddy import setup_docs

app = FastAPI(
    title="Demo API",
    version="0.4.0",
    description="""
A demonstration of LLM-enhanced API documentation using [docbuddy](https://github.com/pearsonkyle/docbuddy).


## Features
- 💬 AI chat assistant with full OpenAPI context
- 🤖 LLM Settings with local providers (Ollama, LM Studio, vLLM, Custom)
- 🔗 Tool-calling for API Requests
- 🎨 Dark/light theme support


## Installation
```bash
pip install docbuddy
```


## Quick Start
```python
from fastapi import FastAPI
from docbuddy import setup_docs

app = FastAPI()
setup_docs(app)  # replaces default /docs
```

""",
)

# Mount the LLM-enhanced Swagger UI (replaces the default /docs)
setup_docs(app, debug=True)

# ── Pydantic Models for Invoicing ────────────────────────────────────────────
class LineItem(BaseModel):
    """A single line item in an invoice."""
    description: str = Field(..., description="Description of the item")
    quantity: int = Field(default=1, ge=1, description="Quantity of items")
    unit_price: float = Field(..., gt=0, description="Price per unit")

class CreateInvoice(BaseModel):
    """Input model for creating a new invoice."""
    customer_name: str = Field(..., min_length=1, description="Customer's name")
    customer_email: str = Field(..., description="Customer's email address")
    items: List[LineItem] = Field(..., min_length=1, description="List of line items")
    due_date: date = Field(default_factory=date.today, description="Invoice due date")

class Invoice(BaseModel):
    """Complete invoice model."""
    id: int
    created_at: date
    customer_name: str
    customer_email: str
    items: List[LineItem]
    due_date: date
    total_amount: float

class InvoiceFilter(BaseModel):
    """Filter parameters for invoice queries."""
    customer_name: Optional[str] = Field(None, min_length=1, description="Filter by customer name (partial match)")
    start_date: Optional[date] = Field(None, description="Start date for filtering (inclusive)")
    end_date: Optional[date] = Field(None, description="End date for filtering (inclusive)")
    min_total: Optional[float] = Field(None, ge=0, description="Minimum total amount")
    max_total: Optional[float] = Field(None, ge=0, description="Maximum total amount")
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$", description="Currency code (ISO 4217)")

# ── In-Memory Storage ───────────────────────────────────────────────────────
invoices: List[Invoice] = []
invoice_counter = 0
_invoice_lock = threading.Lock()

# ── Endpoints ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["utility"])
async def health():
    """Health check endpoint.
    Returns the health status of the service. This endpoint is used for
    basic uptime monitoring.
    """
    return {"status": "ok"}

@app.get("/invoices", tags=["invoices"])
async def list_invoices(
    customer_name: Optional[str] = Query(default=None, min_length=1, description="Filter by customer name (partial match)"),
    start_date: Optional[date] = Query(default=None, description="Start date for filtering (inclusive)"),
    end_date: Optional[date] = Query(default=None, description="End date for filtering (inclusive)"),
    min_total: Optional[float] = Query(default=None, ge=0, description="Minimum total amount"),
    max_total: Optional[float] = Query(default=None, ge=0, description="Maximum total amount"),
    limit: int = Query(default=10, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(default=0, ge=0, description="Number of results to skip"),
):
    """List invoices with pagination and advanced filtering.
    
    Supports combined customer name and date range filters for optimized queries.
    Returns total count in X-Total-Count header.
    """
    # Start with all invoices
    filtered_invoices = []
    
    for invoice in invoices:
        # Customer name filter (case-insensitive partial match)
        if customer_name and customer_name.lower() not in invoice.customer_name.lower():
            continue
        
        # Date range filtering
        if start_date and invoice.created_at < start_date:
            continue
        
        if end_date and invoice.created_at > end_date:
            continue
        
        # Total amount range filtering
        if min_total is not None and invoice.total_amount < min_total:
            continue
            
        if max_total is not None and invoice.total_amount > max_total:
            continue
        
        filtered_invoices.append(invoice)
    
    # Pagination
    total_count = len(filtered_invoices)
    paginated_invoices = filtered_invoices[offset:offset + limit]
    
    # Return JSON response with total count header
    return JSONResponse(
        content=[inv.model_dump(mode="json") for inv in paginated_invoices],
        headers={"X-Total-Count": str(total_count)}
    )

@app.post("/invoices", response_model=Invoice, status_code=201, tags=["invoices"])
async def create_invoice(invoice_data: CreateInvoice):
    """Create a new invoice.
    
    Creates an invoice from the provided data and assigns it a unique ID.
    """
    global invoice_counter

    # Calculate total amount
    total = sum(item.quantity * item.unit_price for item in invoice_data.items)

    with _invoice_lock:
        invoice_counter += 1
        new_invoice = Invoice(
            id=invoice_counter,
            created_at=date.today(),
            total_amount=total,
            **invoice_data.model_dump()
        )
        invoices.append(new_invoice)

    return new_invoice

@app.get("/invoices/{invoice_id}", response_model=Invoice, tags=["invoices"])
async def get_invoice(invoice_id: int):
    """Get a specific invoice by ID.
    
    Retrieves the details of an invoice including all line items and totals.
    """
    for invoice in invoices:
        if invoice.id == invoice_id:
            return invoice
    
    raise HTTPException(status_code=404, detail="Invoice not found")

# ── Error handlers ───────────────────────────────────────────────────────────
@app.exception_handler(502)
async def proxy_error_handler(request, exc):
    """Custom handler for proxy errors."""
    return JSONResponse(
        status_code=502,
        content={
            "error": "Proxy error",
            "message": str(exc),
            "hint": "Check your LLM provider settings in the Swagger UI panel",
        },
    )

# ── Main entry point for development ────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)