# backend/src/billing/models.py
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, validator
import uuid
from decimal import Decimal


# Enums
class SubscriptionPlan(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    TRIALING = "trialing"
    INCOMPLETE = "incomplete"
    INCOMPLETE_EXPIRED = "incomplete_expired"


class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    OPEN = "open"
    PAID = "paid"
    VOID = "void"
    UNCOLLECTIBLE = "uncollectible"


class PaymentStatus(str, Enum):
    SUCCEEDED = "succeeded"
    PENDING = "pending"
    FAILED = "failed"
    CANCELED = "canceled"


class Currency(str, Enum):
    EUR = "EUR"
    USD = "USD"
    GBP = "GBP"


# Base models
class BaseBillingModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    class Config:
        from_attributes = True


# Subscription models
class SubscriptionBase(BaseModel):
    plan_type: SubscriptionPlan = SubscriptionPlan.FREE
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool = False
    
    # Pricing
    amount: Decimal = Field(ge=0)
    currency: Currency = Currency.EUR
    interval: str = "month"  # month, year
    
    # Stripe IDs
    stripe_subscription_id: Optional[str] = None
    stripe_customer_id: Optional[str] = None


class SubscriptionCreate(SubscriptionBase):
    company_id: str
    created_by: str


class SubscriptionUpdate(BaseModel):
    plan_type: Optional[SubscriptionPlan] = None
    status: Optional[SubscriptionStatus] = None
    cancel_at_period_end: Optional[bool] = None
    amount: Optional[Decimal] = None
    interval: Optional[str] = None


class SubscriptionInDB(BaseBillingModel, SubscriptionBase):
    company_id: str
    created_by: str
    canceled_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


# Invoice models
class InvoiceLineItem(BaseModel):
    description: str
    quantity: int = 1
    unit_price: Decimal
    amount: Decimal
    tax_rate: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None


class InvoiceBase(BaseModel):
    invoice_number: str
    status: InvoiceStatus = InvoiceStatus.DRAFT
    amount_due: Decimal
    amount_paid: Decimal = Field(default=Decimal('0'))
    currency: Currency = Currency.EUR
    vat_percentage: Decimal = Field(default=Decimal('21.00'))
    vat_amount: Decimal = Field(default=Decimal('0'))
    total_amount: Decimal
    
    # Dates
    issue_date: datetime
    due_date: datetime
    paid_date: Optional[datetime] = None
    
    # Billing info
    billing_address: Optional[Dict[str, Any]] = None
    
    # Line items
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    notes: Optional[str] = None
    
    # PDF
    pdf_url: Optional[str] = None
    
    # Stripe
    stripe_invoice_id: Optional[str] = None


class InvoiceCreate(InvoiceBase):
    company_id: str
    project_id: Optional[str] = None
    subscription_id: Optional[str] = None


class InvoiceUpdate(BaseModel):
    status: Optional[InvoiceStatus] = None
    amount_paid: Optional[Decimal] = None
    paid_date: Optional[datetime] = None
    pdf_url: Optional[str] = None
    notes: Optional[str] = None


class InvoiceInDB(BaseBillingModel, InvoiceBase):
    company_id: str
    project_id: Optional[str]
    subscription_id: Optional[str]


# Payment models
class PaymentBase(BaseModel):
    status: PaymentStatus
    amount: Decimal
    currency: Currency = Currency.EUR
    payment_method: str
    
    # Stripe
    stripe_payment_intent_id: Optional[str] = None
    stripe_charge_id: Optional[str] = None
    
    # Receipt
    receipt_url: Optional[str] = None


class PaymentCreate(PaymentBase):
    invoice_id: str
    company_id: str


class PaymentInDB(BaseBillingModel, PaymentBase):
    invoice_id: str
    company_id: str
    paid_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


# Plan pricing models
class PlanPricing(BaseModel):
    plan_type: SubscriptionPlan
    monthly_price: Decimal
    yearly_price: Decimal
    currency: Currency = Currency.EUR
    features: List[str] = Field(default_factory=list)
    limits: Dict[str, Any] = Field(default_factory=dict)


# Webhook models
class WebhookEvent(BaseModel):
    id: str
    type: str
    data: Dict[str, Any]
    created_at: datetime


# Response models
class BillingOverview(BaseModel):
    active_subscription: Optional[SubscriptionInDB] = None
    total_invoiced: Decimal = Field(default=Decimal('0'))
    total_paid: Decimal = Field(default=Decimal('0'))
    outstanding_balance: Decimal = Field(default=Decimal('0'))
    upcoming_invoice: Optional[InvoiceInDB] = None
    payment_methods: List[Dict[str, Any]] = Field(default_factory=list)


class InvoiceWithPayments(InvoiceInDB):
    payments: List[PaymentInDB] = Field(default_factory=list)
    subscription: Optional[SubscriptionInDB] = None
    project: Optional[Dict[str, Any]] = None
