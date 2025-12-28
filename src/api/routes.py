# backend/src/api/routes.py
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request

from core.models import StandardResponse, UserRole
from auth.dependencies import auth_deps
from .gateway import api_key_manager, analytics_service

router = APIRouter(prefix="/api", tags=["api-management"])


@router.post("/keys", response_model=StandardResponse)
async def create_api_key(
    name: str,
    permissions: Dict[str, bool],
    rate_limit: int = 60,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Create API key for external integrations
    """
    try:
        api_key = await api_key_manager.create_api_key(
            company_id=current_user.company_id,
            user_id=current_user.sub,
            name=name,
            permissions=permissions,
            rate_limit=rate_limit
        )
        
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create API key"
            )
        
        return StandardResponse(
            success=True,
            message="API key created successfully",
            data={"api_key": api_key}  # Show only once!
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create API key: {str(e)}"
        )


@router.get("/keys", response_model=StandardResponse)
async def list_api_keys(
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    List API keys for company
    """
    try:
        # This would require database method
        keys = []  # await database.get_company_api_keys(current_user.company_id)
        
        return StandardResponse(
            success=True,
            message=f"Found {len(keys)} API keys",
            data={"keys": keys}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list API keys: {str(e)}"
        )


@router.delete("/keys/{key_id}", response_model=StandardResponse)
async def revoke_api_key(
    key_id: str,
    current_user: dict = Depends(auth_deps.require_company_admin)
):
    """
    Revoke API key
    """
    try:
        success = False  # await database.revoke_api_key(key_id, current_user.company_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to revoke API key"
            )
        
        return StandardResponse(
            success=True,
            message="API key revoked successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to revoke API key: {str(e)}"
        )


@router.get("/analytics/usage", response_model=StandardResponse)
async def get_usage_analytics(
    period: str = "day",
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get usage analytics for company
    """
    try:
        metrics = await analytics_service.get_company_metrics(
            current_user.company_id, period
        )
        
        return StandardResponse(
            success=True,
            message="Usage analytics retrieved",
            data={"metrics": metrics}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get analytics: {str(e)}"
        )


@router.post("/analytics/events", response_model=StandardResponse)
async def record_custom_event(
    event_type: str,
    event_data: Dict[str, any],
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Record custom analytics event
    """
    try:
        await analytics_service.record_event(
            current_user.company_id,
            event_type,
            event_data
        )
        
        return StandardResponse(
            success=True,
            message="Event recorded successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record event: {str(e)}"
        )


@router.get("/rate-limits", response_model=StandardResponse)
async def get_rate_limit_info(
    current_user: dict = Depends(auth_deps.get_current_active_user)
):
    """
    Get rate limit information for current user/company
    """
    try:
        from billing.service import billing_service
        from .gateway import rate_limiter
        
        # Get subscription
        subscription = await billing_service.get_company_subscription(current_user.company_id)
        plan = subscription.plan_type if subscription else SubscriptionPlan.FREE
        
        limits = rate_limiter.plan_limits.get(plan, rate_limiter.plan_limits[SubscriptionPlan.FREE])
        
        return StandardResponse(
            success=True,
            message="Rate limit information",
            data={
                "plan": plan.value,
                "limits": limits,
                "current_period": "minute"  # Could be dynamic
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get rate limit info: {str(e)}"
        )
