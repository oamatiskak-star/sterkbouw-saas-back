# backend/src/billing/routes.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks
from fastapi.responses import JSONResponse

from core.models import StandardResponse, UserRole
from auth.dependencies import auth_deps
from .models import *
from .service import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans", response_model=StandardResponse)
async def get_available_plans():
    """
    Get all available subscription plans
    """
    try:
        plans = await billing_service.get_all_plans()
        
        return StandardResponse(
            success=True,
            message=f"Found {len(plans)} plans",
            data={"plans": [plan.dict() for plan in plans]}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get plans: {str(e)}"
        )


@router.post("/subscriptions", response_model=StandardResponse)
async def create_subscription(
    plan_type: SubscriptionPlan,
    interval: str = "month",
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Create subscription for company
    """
    try:
        subscription = await billing_service.create_subscription(
            company_id=current_user.company_id,
            plan_type=plan_type,
            created_by=current_user.sub,
            interval=interval
        )
        
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create subscription"
            )
        
        return StandardResponse(
            success=True,
            message="Subscription created successfully",
            data={"subscription": subscription.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create subscription: {str(e)}"
        )


@router.get("/subscriptions/current", response_model=StandardResponse)
async def get_current_subscription(
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get current subscription for company
    """
    try:
        subscription = await billing_service.get_company_subscription(current_user.company_id)
        
        if not subscription:
            return StandardResponse(
                success=True,
                message="No active subscription found",
                data={"subscription": None}
            )
        
        return StandardResponse(
            success=True,
            message="Subscription retrieved",
            data={"subscription": subscription.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get subscription: {str(e)}"
        )


@router.put("/subscriptions/{subscription_id}/cancel", response_model=StandardResponse)
async def cancel_subscription(
    subscription_id: str,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Cancel subscription
    """
    try:
        success = await billing_service.cancel_subscription(
            subscription_id=subscription_id,
            company_id=current_user.company_id,
            user_id=current_user.sub,
            user_role=current_user.role
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to cancel subscription"
            )
        
        return StandardResponse(
            success=True,
            message="Subscription canceled successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel subscription: {str(e)}"
        )


@router.put("/subscriptions/{subscription_id}/upgrade", response_model=StandardResponse)
async def upgrade_subscription(
    subscription_id: str,
    new_plan: SubscriptionPlan,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Upgrade subscription plan
    """
    try:
        success = await billing_service.update_subscription_plan(
            subscription_id=subscription_id,
            new_plan=new_plan,
            company_id=current_user.company_id,
            user_id=current_user.sub,
            user_role=current_user.role
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to upgrade subscription"
            )
        
        return StandardResponse(
            success=True,
            message="Subscription upgraded successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upgrade subscription: {str(e)}"
        )


@router.post("/invoices", response_model=StandardResponse)
async def create_invoice(
    amount: float,
    description: str,
    project_id: Optional[str] = None,
    subscription_id: Optional[str] = None,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Create invoice
    """
    try:
        from decimal import Decimal
        
        invoice = await billing_service.create_invoice(
            company_id=current_user.company_id,
            amount=Decimal(str(amount)),
            description=description,
            project_id=project_id,
            subscription_id=subscription_id
        )
        
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create invoice"
            )
        
        return StandardResponse(
            success=True,
            message="Invoice created successfully",
            data={"invoice": invoice.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create invoice: {str(e)}"
        )


@router.get("/invoices", response_model=StandardResponse)
async def get_invoices(
    status: Optional[InvoiceStatus] = None,
    page: int = 1,
    limit: int = 20,
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get company invoices
    """
    try:
        # This would require database method implementation
        # For now, return empty
        return StandardResponse(
            success=True,
            message="Invoices retrieved",
            data={
                "invoices": [],
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": 0,
                    "pages": 0
                }
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get invoices: {str(e)}"
        )


@router.get("/invoices/{invoice_id}", response_model=StandardResponse)
async def get_invoice(
    invoice_id: str,
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get invoice details
    """
    try:
        invoice = await billing_service.get_invoice(invoice_id)
        
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        
        # Check permissions
        if invoice.company_id != current_user.company_id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
        
        return StandardResponse(
            success=True,
            message="Invoice retrieved",
            data={"invoice": invoice.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get invoice: {str(e)}"
        )


@router.post("/invoices/{invoice_id}/pay", response_model=StandardResponse)
async def pay_invoice(
    invoice_id: str,
    payment_method: str,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Mark invoice as paid
    """
    try:
        from decimal import Decimal
        
        # Get invoice first
        invoice = await billing_service.get_invoice(invoice_id)
        if not invoice or invoice.company_id != current_user.company_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        
        # Calculate amount due
        amount_due = Decimal(str(invoice.total_amount)) - Decimal(str(invoice.amount_paid))
        
        # Create payment
        payment_data = PaymentCreate(
            invoice_id=invoice_id,
            company_id=current_user.company_id,
            status=PaymentStatus.SUCCEEDED,
            amount=amount_due,
            currency=invoice.currency,
            payment_method=payment_method
        )
        
        success = await billing_service.mark_invoice_paid(invoice_id, payment_data)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to process payment"
            )
        
        return StandardResponse(
            success=True,
            message="Payment processed successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process payment: {str(e)}"
        )


@router.get("/overview", response_model=StandardResponse)
async def get_billing_overview(
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get billing overview for company
    """
    try:
        overview = await billing_service.get_billing_overview(current_user.company_id)
        
        return StandardResponse(
            success=True,
            message="Billing overview retrieved",
            data={"overview": overview.dict() if overview else None}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get billing overview: {str(e)}"
        )


@router.get("/usage", response_model=StandardResponse)
async def get_usage_stats(
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get usage statistics for current billing period
    """
    try:
        # Get subscription
        subscription = await billing_service.get_company_subscription(current_user.company_id)
        
        if not subscription:
            return StandardResponse(
                success=True,
                message="No subscription found",
                data={"usage": None}
            )
        
        # Get plan limits
        plan_pricing = await billing_service.get_plan_pricing(subscription.plan_type)
        
        # Get actual usage (simplified - would need actual counts)
        usage = {
            "projects_used": 0,  # Would get from database
            "projects_limit": plan_pricing.limits.get("max_projects", 0) if plan_pricing else 0,
            "users_used": 0,  # Would get from database
            "users_limit": plan_pricing.limits.get("max_users", 0) if plan_pricing else 0,
            "documents_used": 0,  # Would get from database
            "documents_limit": plan_pricing.limits.get("max_documents_per_project", 0) if plan_pricing else 0,
            "storage_used_gb": 0,  # Would calculate from storage
            "storage_limit_gb": plan_pricing.limits.get("storage_gb", 0) if plan_pricing else 0
        }
        
        return StandardResponse(
            success=True,
            message="Usage statistics retrieved",
            data={"usage": usage}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get usage stats: {str(e)}"
        )
