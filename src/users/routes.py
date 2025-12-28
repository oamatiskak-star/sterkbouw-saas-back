# backend/src/users/routes.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query

from core.models import UserPublic, UserUpdate, StandardResponse
from auth.dependencies import auth_deps
from .service import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=StandardResponse)
async def get_my_profile(
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get current user's profile
    """
    try:
        user = await user_service.get_user(current_user.sub)
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        user_public = UserPublic(
            id=user["id"],
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            role=user["role"],
            status=user["status"],
            company_id=user.get("company_id"),
            avatar_url=user.get("avatar_url"),
            created_at=user["created_at"]
        )
        
        return StandardResponse(
            success=True,
            message="Profile retrieved",
            data={"user": user_public.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get profile: {str(e)}"
        )


@router.put("/me", response_model=StandardResponse)
async def update_my_profile(
    update_data: UserUpdate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Update current user's profile
    """
    try:
        updated_user = await user_service.update_user(
            user_id=current_user.sub,
            update_data=update_data,
            current_user_id=current_user.sub
        )
        
        if not updated_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update profile"
            )
        
        return StandardResponse(
            success=True,
            message="Profile updated successfully",
            data={"user": updated_user.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update profile: {str(e)}"
        )


@router.delete("/me", response_model=StandardResponse)
async def delete_my_account(
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Delete current user's account (soft delete)
    """
    try:
        success = await user_service.delete_user(current_user.sub, current_user.sub)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to delete account"
            )
        
        return StandardResponse(
            success=True,
            message="Account deleted successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete account: {str(e)}"
        )


@router.get("/company/{company_id}", response_model=StandardResponse)
async def get_company_users(
    company_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get all users in a company (company admin or admin only)
    """
    try:
        users = await user_service.get_company_users(company_id, current_user)
        
        return StandardResponse(
            success=True,
            message=f"Found {len(users)} users",
            data={"users": [user.dict() for user in users]}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get company users: {str(e)}"
        )


# Admin routes
@router.get("/admin/all", response_model=StandardResponse)
async def get_all_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(auth_deps.require_admin)
):
    """
    Get all users (admin only)
    """
    try:
        # TODO: Implement pagination
        # For now, return empty list
        return StandardResponse(
            success=True,
            message="Users retrieved",
            data={"users": [], "page": page, "limit": limit, "total": 0}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get users: {str(e)}"
        )
