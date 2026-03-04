from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import date
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
- 📊 Advanced filtering and analytics endpoints
- 🔗 Dynamic XML/JSON mapping from tool outputs
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
### Example
Use the **Chat** panel to ask questions about these endpoints!
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
    filter: Optional[InvoiceFilter] = None,
    limit: int = Query(default=10, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(default=0, ge=0, description="Number of results to skip"),
):
    """List invoices with pagination and advanced filtering.
    
    Supports combined customer name and date range filters for optimized queries.
    Returns total count in X-Total-Count header.
    """
    if filter is None:
        filter = InvoiceFilter()
    
    # Start with all invoices
    filtered_invoices = []
    
    for invoice in invoices:
        # Customer name filter (case-insensitive partial match)
        if filter.customer_name and filter.customer_name.lower() not in invoice.customer_name.lower():
            continue
        
        # Date range validation
        if filter.start_date and invoice.created_at < filter.start_date:
            continue
        
        if filter.end_date and invoice.created_at > filter.end_date:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date range: end_date ({filter.end_date}) is before some invoice dates"
            )
        
        # Total amount range validation
        if filter.min_total is not None and invoice.total_amount < filter.min_total:
            continue
            
        if filter.max_total is not None and invoice.total_amount > filter.max_total:
            continue
        
        filtered_invoices.append(invoice)
    
    # Pagination
    total_count = len(filtered_invoices)
    paginated_invoices = filtered_invoices[offset:offset + limit]
    
    # Return JSON response with total count header
    return PlainTextResponse(
        content=str(paginated_invoices),
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
    invoice_counter += 1
    
    new_invoice = Invoice(
        id=invoice_counter,
        created_at=date.today(),
        total_amount=total,
        **invoice_data.model_dump()
    )
    
    # Add the calculated total
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
    
    return JSONResponse(
        status_code=404,
        content={"error": "Invoice not found"}
    )

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
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)