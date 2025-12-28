# backend/src/billing/service.py
import stripe
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

from core.config import settings
from core.database import database
from core.models import UserRole
from .models import *


class BillingService:
    def __init__(self):
        self.db = database
        self.stripe_api_key = settings.STRIPE_SECRET_KEY
        
        # Configure Stripe if API key is available
        if self.stripe_api_key:
            stripe.api_key = self.stripe_api_key
        
        # Plan pricing configuration
        self.plan_pricing = {
            SubscriptionPlan.FREE: PlanPricing(
                plan_type=SubscriptionPlan.FREE,
                monthly_price=Decimal('0'),
                yearly_price=Decimal('0'),
                features=[
                    "Max 3 projecten",
                    "Basis document analyse",
                    "1 gebruiker",
                    "Community support"
                ],
                limits={
                    "max_projects": 3,
                    "max_users": 1,
                    "max_documents_per_project": 10,
                    "storage_gb": 1
                }
            ),
            SubscriptionPlan.BASIC: PlanPricing(
                plan_type=SubscriptionPlan.BASIC,
                monthly_price=Decimal('49'),
                yearly_price=Decimal('490'),  # ~2 maanden gratis
                features=[
                    "Max 10 projecten",
                    "Geavanceerde document analyse",
                    "5 gebruikers",
                    "Email support",
                    "STABU prijzen database"
                ],
                limits={
                    "max_projects": 10,
                    "max_users": 5,
                    "max_documents_per_project": 50,
                    "storage_gb": 10
                }
            ),
            SubscriptionPlan.PROFESSIONAL: PlanPricing(
                plan_type=SubscriptionPlan.PROFESSIONAL,
                monthly_price=Decimal('149'),
                yearly_price=Decimal('1490'),  # ~2 maanden gratis
                features=[
                    "Onbeperkt projecten",
                    "AI-powered kostenoptimalisatie",
                    "20 gebruikers",
                    "Priority support",
                    "API toegang",
                    "Aangepaste rapporten"
                ],
                limits={
                    "max_projects": 999,
                    "max_users": 20,
                    "max_documents_per_project": 200,
                    "storage_gb": 50
                }
            ),
            SubscriptionPlan.ENTERPRISE: PlanPricing(
                plan_type=SubscriptionPlan.ENTERPRISE,
                monthly_price=Decimal('499'),
                yearly_price=Decimal('4990'),  # ~2 maanden gratis
                features=[
                    "Alles in Professional",
                    "Onbeperkt gebruikers",
                    "Dedicated account manager",
                    "SLA 99.9%",
                    "White-label oplossing",
                    "Aangepaste integraties"
                ],
                limits={
                    "max_projects": 9999,
                    "max_users": 999,
                    "max_documents_per_project": 999,
                    "storage_gb": 500
                }
            )
        }
    
    # ==================== SUBSCRIPTION OPERATIONS ====================
    
    async def create_subscription(self, company_id: str, plan_type: SubscriptionPlan, 
                                created_by: str, interval: str = "month") -> Optional[SubscriptionInDB]:
        """Create a new subscription"""
        try:
            # Get plan pricing
            plan = self.plan_pricing.get(plan_type)
            if not plan:
                return None
            
            # Calculate amount based on interval
            amount = plan.yearly_price if interval == "year" else plan.monthly_price
            
            # Calculate period dates
            now = datetime.now()
            if interval == "year":
                period_end = now + timedelta(days=365)
            else:
                period_end = now + timedelta(days=30)
            
            # Create subscription in database
            subscription_id = str(uuid.uuid4())
            subscription_data = {
                "id": subscription_id,
                "company_id": company_id,
                "created_by": created_by,
                "plan_type": plan_type.value,
                "status": SubscriptionStatus.ACTIVE.value,
                "current_period_start": now.isoformat(),
                "current_period_end": period_end.isoformat(),
                "amount": float(amount),
                "currency": "EUR",
                "interval": interval,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat()
            }
            
            # Create Stripe subscription if API key is available
            if self.stripe_api_key:
                try:
                    # First create or get Stripe customer
                    customer = await self._get_or_create_stripe_customer(company_id, created_by)
                    if customer:
                        subscription_data["stripe_customer_id"] = customer.id
                        
                        # Create Stripe subscription
                        stripe_subscription = stripe.Subscription.create(
                            customer=customer.id,
                            items=[{
                                'price_data': {
                                    'currency': 'eur',
                                    'product_data': {
                                        'name': f'SterkBouw {plan_type.value.title()} Plan',
                                    },
                                    'unit_amount': int(amount * 100),  # Convert to cents
                                    'recurring': {
                                        'interval': interval,
                                    },
                                },
                            }],
                            metadata={
                                'company_id': company_id,
                                'plan_type': plan_type.value
                            }
                        )
                        subscription_data["stripe_subscription_id"] = stripe_subscription.id
                except Exception as e:
                    print(f"Stripe subscription creation failed: {e}")
                    # Continue without Stripe for now
            
            # Save to database
            subscription = await self.db.create_subscription(subscription_data)
            if not subscription:
                return None
            
            # Update company plan
            await self.db.update_company(company_id, {
                "plan_type": plan_type.value,
                "subscription_status": SubscriptionStatus.ACTIVE.value,
                "subscription_id": subscription_id,
                "updated_at": datetime.now().isoformat()
            })
            
            return SubscriptionInDB(**subscription)
            
        except Exception as e:
            print(f"Error creating subscription: {e}")
            return None
    
    async def get_subscription(self, subscription_id: str) -> Optional[SubscriptionInDB]:
        """Get subscription by ID"""
        try:
            subscription = await self.db.get_subscription_by_id(subscription_id)
            if not subscription:
                return None
            
            return SubscriptionInDB(**subscription)
        except Exception as e:
            print(f"Error getting subscription: {e}")
            return None
    
    async def get_company_subscription(self, company_id: str) -> Optional[SubscriptionInDB]:
        """Get active subscription for company"""
        try:
            subscription = await self.db.get_company_active_subscription(company_id)
            if not subscription:
                return None
            
            return SubscriptionInDB(**subscription)
        except Exception as e:
            print(f"Error getting company subscription: {e}")
            return None
    
    async def cancel_subscription(self, subscription_id: str, company_id: str, 
                                user_id: str, user_role: UserRole) -> bool:
        """Cancel subscription"""
        try:
            # Check permissions
            if user_role not in [UserRole.ADMIN, UserRole.COMPANY_ADMIN]:
                return False
            
            # Get subscription
            subscription = await self.get_subscription(subscription_id)
            if not subscription or subscription.company_id != company_id:
                return False
            
            # Update in database
            update_data = {
                "status": SubscriptionStatus.CANCELED.value,
                "canceled_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            # Cancel Stripe subscription if exists
            if subscription.stripe_subscription_id and self.stripe_api_key:
                try:
                    stripe.Subscription.delete(subscription.stripe_subscription_id)
                except Exception as e:
                    print(f"Stripe cancellation failed: {e}")
            
            updated = await self.db.update_subscription(subscription_id, update_data)
            
            # Update company
            if updated:
                await self.db.update_company(company_id, {
                    "subscription_status": SubscriptionStatus.CANCELED.value,
                    "updated_at": datetime.now().isoformat()
                })
            
            return updated is not None
            
        except Exception as e:
            print(f"Error canceling subscription: {e}")
            return False
    
    async def update_subscription_plan(self, subscription_id: str, new_plan: SubscriptionPlan,
                                     company_id: str, user_id: str, user_role: UserRole) -> bool:
        """Update subscription plan"""
        try:
            # Check permissions
            if user_role not in [UserRole.ADMIN, UserRole.COMPANY_ADMIN]:
                return False
            
            # Get subscription and new plan pricing
            subscription = await self.get_subscription(subscription_id)
            new_plan_pricing = self.plan_pricing.get(new_plan)
            
            if not subscription or not new_plan_pricing or subscription.company_id != company_id:
                return False
            
            # Calculate new amount
            amount = new_plan_pricing.yearly_price if subscription.interval == "year" else new_plan_pricing.monthly_price
            
            # Update in database
            update_data = {
                "plan_type": new_plan.value,
                "amount": float(amount),
                "updated_at": datetime.now().isoformat()
            }
            
            # Update Stripe if exists
            if subscription.stripe_subscription_id and self.stripe_api_key:
                try:
                    # Get current subscription
                    stripe_sub = stripe.Subscription.retrieve(subscription.stripe_subscription_id)
                    
                    # Update subscription item
                    if stripe_sub['items']['data']:
                        item_id = stripe_sub['items']['data'][0].id
                        
                        stripe.Subscription.modify(
                            subscription.stripe_subscription_id,
                            items=[{
                                'id': item_id,
                                'price_data': {
                                    'currency': 'eur',
                                    'product_data': {
                                        'name': f'SterkBouw {new_plan.value.title()} Plan',
                                    },
                                    'unit_amount': int(amount * 100),
                                    'recurring': {
                                        'interval': subscription.interval,
                                    },
                                },
                            }],
                            proration_behavior='always_invoice'
                        )
                except Exception as e:
                    print(f"Stripe plan update failed: {e}")
            
            updated = await self.db.update_subscription(subscription_id, update_data)
            
            # Update company
            if updated:
                await self.db.update_company(company_id, {
                    "plan_type": new_plan.value,
                    "updated_at": datetime.now().isoformat()
                })
            
            return updated is not None
            
        except Exception as e:
            print(f"Error updating subscription plan: {e}")
            return False
    
    # ==================== INVOICE OPERATIONS ====================
    
    async def create_invoice(self, company_id: str, amount: Decimal, 
                           description: str, project_id: Optional[str] = None,
                           subscription_id: Optional[str] = None) -> Optional[InvoiceInDB]:
        """Create invoice"""
        try:
            # Calculate VAT
            vat_percentage = Decimal('21.00')
            vat_amount = amount * (vat_percentage / 100)
            total_amount = amount + vat_amount
            
            # Generate invoice number
            invoice_number = await self._generate_invoice_number()
            
            # Create invoice
            now = datetime.now()
            due_date = now + timedelta(days=30)
            
            line_items = [InvoiceLineItem(
                description=description,
                quantity=1,
                unit_price=amount,
                amount=amount
            )]
            
            invoice_data = {
                "id": str(uuid.uuid4()),
                "invoice_number": invoice_number,
                "company_id": company_id,
                "project_id": project_id,
                "subscription_id": subscription_id,
                "status": InvoiceStatus.DRAFT.value,
                "amount_due": float(amount),
                "amount_paid": 0.0,
                "currency": "EUR",
                "vat_percentage": float(vat_percentage),
                "vat_amount": float(vat_amount),
                "total_amount": float(total_amount),
                "issue_date": now.isoformat(),
                "due_date": due_date.isoformat(),
                "line_items": [item.dict() for item in line_items],
                "created_at": now.isoformat(),
                "updated_at": now.isoformat()
            }
            
            # Create Stripe invoice if API key available
            if self.stripe_api_key:
                try:
                    # Get or create Stripe customer
                    subscription = await self.get_subscription(subscription_id) if subscription_id else None
                    stripe_customer_id = subscription.stripe_customer_id if subscription else None
                    
                    if stripe_customer_id:
                        stripe_invoice = stripe.Invoice.create(
                            customer=stripe_customer_id,
                            auto_advance=True,
                            collection_method='send_invoice',
                            days_until_due=30,
                            metadata={
                                'company_id': company_id,
                                'project_id': project_id or '',
                                'invoice_number': invoice_number
                            }
                        )
                        
                        # Add invoice item
                        stripe.InvoiceItem.create(
                            customer=stripe_customer_id,
                            invoice=stripe_invoice.id,
                            amount=int(amount * 100),
                            currency='eur',
                            description=description
                        )
                        
                        # Finalize invoice
                        stripe_invoice = stripe.Invoice.finalize_invoice(stripe_invoice.id)
                        
                        invoice_data["stripe_invoice_id"] = stripe_invoice.id
                        invoice_data["status"] = InvoiceStatus.OPEN.value
                        invoice_data["pdf_url"] = stripe_invoice.invoice_pdf
                except Exception as e:
                    print(f"Stripe invoice creation failed: {e}")
            
            invoice = await self.db.create_invoice(invoice_data)
            if not invoice:
                return None
            
            return InvoiceInDB(**invoice)
            
        except Exception as e:
            print(f"Error creating invoice: {e}")
            return None
    
    async def get_invoice(self, invoice_id: str) -> Optional[InvoiceWithPayments]:
        """Get invoice with payments"""
        try:
            invoice = await self.db.get_invoice_by_id(invoice_id)
            if not invoice:
                return None
            
            # Get payments
            payments = await self.db.get_invoice_payments(invoice_id)
            
            # Get subscription if exists
            subscription = None
            if invoice.get("subscription_id"):
                subscription = await self.get_subscription(invoice["subscription_id"])
            
            # Get project if exists
            project = None
            if invoice.get("project_id"):
                project = await self.db.get_project_by_id(invoice["project_id"])
            
            return InvoiceWithPayments(
                **invoice,
                payments=[PaymentInDB(**p) for p in payments],
                subscription=subscription,
                project=project
            )
        except Exception as e:
            print(f"Error getting invoice: {e}")
            return None
    
    async def mark_invoice_paid(self, invoice_id: str, payment_data: PaymentCreate) -> bool:
        """Mark invoice as paid"""
        try:
            invoice = await self.db.get_invoice_by_id(invoice_id)
            if not invoice:
                return False
            
            # Create payment record
            payment_dict = {
                **payment_data.dict(exclude={"invoice_id", "company_id"}),
                "id": str(uuid.uuid4()),
                "invoice_id": invoice_id,
                "company_id": invoice["company_id"],
                "paid_at": datetime.now().isoformat(),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            payment = await self.db.create_payment(payment_dict)
            if not payment:
                return False
            
            # Update invoice
            amount_paid = invoice.get("amount_paid", 0) + payment_data.amount
            update_data = {
                "amount_paid": float(amount_paid),
                "updated_at": datetime.now().isoformat()
            }
            
            if amount_paid >= invoice.get("total_amount", 0):
                update_data["status"] = InvoiceStatus.PAID.value
                update_data["paid_date"] = datetime.now().isoformat()
            
            updated = await self.db.update_invoice(invoice_id, update_data)
            
            return updated is not None
            
        except Exception as e:
            print(f"Error marking invoice paid: {e}")
            return False
    
    # ==================== PAYMENT OPERATIONS ====================
    
    async def create_payment(self, payment_data: PaymentCreate) -> Optional[PaymentInDB]:
        """Create payment record"""
        try:
            payment_dict = {
                **payment_data.dict(),
                "id": str(uuid.uuid4()),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            payment = await self.db.create_payment(payment_dict)
            if not payment:
                return None
            
            return PaymentInDB(**payment)
        except Exception as e:
            print(f"Error creating payment: {e}")
            return None
    
    # ==================== BILLING OVERVIEW ====================
    
    async def get_billing_overview(self, company_id: str) -> Optional[BillingOverview]:
        """Get billing overview for company"""
        try:
            # Get active subscription
            subscription = await self.get_company_subscription(company_id)
            
            # Get invoices
            invoices = await self.db.get_company_invoices(company_id)
            
            # Calculate totals
            total_invoiced = Decimal('0')
            total_paid = Decimal('0')
            upcoming_invoice = None
            
            for invoice in invoices:
                total_invoiced += Decimal(str(invoice.get("total_amount", 0)))
                total_paid += Decimal(str(invoice.get("amount_paid", 0)))
                
                # Find upcoming invoice (not paid, not draft)
                if (invoice.get("status") in [InvoiceStatus.OPEN.value, InvoiceStatus.DRAFT.value] and 
                    not upcoming_invoice):
                    upcoming_invoice = InvoiceInDB(**invoice)
            
            outstanding_balance = total_invoiced - total_paid
            
            # Get payment methods (simplified for now)
            payment_methods = []
            if subscription and subscription.stripe_customer_id and self.stripe_api_key:
                try:
                    stripe_payment_methods = stripe.PaymentMethod.list(
                        customer=subscription.stripe_customer_id,
                        type="card"
                    )
                    payment_methods = [
                        {
                            "id": pm.id,
                            "type": pm.type,
                            "card": {
                                "brand": pm.card.brand,
                                "last4": pm.card.last4,
                                "exp_month": pm.card.exp_month,
                                "exp_year": pm.card.exp_year
                            }
                        }
                        for pm in stripe_payment_methods.data[:3]
                    ]
                except Exception as e:
                    print(f"Error fetching payment methods: {e}")
            
            return BillingOverview(
                active_subscription=subscription,
                total_invoiced=total_invoiced,
                total_paid=total_paid,
                outstanding_balance=outstanding_balance,
                upcoming_invoice=upcoming_invoice,
                payment_methods=payment_methods
            )
            
        except Exception as e:
            print(f"Error getting billing overview: {e}")
            return None
    
    # ==================== HELPER METHODS ====================
    
    async def _generate_invoice_number(self) -> str:
        """Generate unique invoice number"""
        try:
            # Format: INV-YYYY-XXXXXX
            year = datetime.now().strftime('%Y')
            
            # Get count of invoices this year
            count = await self.db.count_invoices_by_year(year)
            
            # Generate number
            number = f"INV-{year}-{str(count + 1).zfill(6)}"
            return number
            
        except Exception:
            # Fallback
            timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
            return f"INV-{timestamp}"
    
    async def _get_or_create_stripe_customer(self, company_id: str, user_id: str) -> Optional[stripe.Customer]:
        """Get or create Stripe customer"""
        if not self.stripe_api_key:
            return None
        
        try:
            # Get company info
            company = await self.db.get_company_by_id(company_id)
            user = await self.db.get_user_by_id(user_id)
            
            if not company or not user:
                return None
            
            # Search for existing customer by metadata
            customers = stripe.Customer.search(
                query=f"metadata['company_id']:'{company_id}'"
            )
            
            if customers.data:
                return customers.data[0]
            
            # Create new customer
            customer = stripe.Customer.create(
                email=user.get("email"),
                name=company.get("name"),
                metadata={
                    'company_id': company_id,
                    'user_id': user_id
                }
            )
            
            return customer
            
        except Exception as e:
            print(f"Error creating Stripe customer: {e}")
            return None
    
    async def get_plan_pricing(self, plan_type: SubscriptionPlan) -> Optional[PlanPricing]:
        """Get pricing for a plan"""
        return self.plan_pricing.get(plan_type)
    
    async def get_all_plans(self) -> List[PlanPricing]:
        """Get all available plans"""
        return list(self.plan_pricing.values())


# Create billing service instance
billing_service = BillingService()
