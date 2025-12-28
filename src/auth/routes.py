# backend/src/auth/routes.py
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer

from core.models import (
    UserCreate, UserPublic, Token, LoginRequest,
    RefreshTokenRequest, PasswordResetRequest,
    PasswordResetConfirm, EmailVerificationRequest,
    StandardResponse
)
from .auth_service import auth_service
from .dependencies import auth_deps

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/register", response_model=StandardResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    request: Request
):
    """
    Register a new user and company
    """
    try:
        user_agent = request.headers.get("user-agent")
        ip_address = request.client.host if request.client else None
        
        user, error = await auth_service.register(user_data)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        # Automatically login after registration
        login_data = LoginRequest(
            email=user_data.email,
            password=user_data.password,
            remember_me=True
        )
        
        token, login_error = await auth_service.login(login_data, user_agent, ip_address)
        
        if login_error:
            # Registration successful but login failed
            return StandardResponse(
                success=True,
                message="Registration successful. Please login.",
                data={
                    "user": user.dict(),
                    "requires_login": True
                }
            )
        
        return StandardResponse(
            success=True,
            message="Registration successful",
            data={
                "user": user.dict(),
                "token": token.dict() if token else None
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {str(e)}"
        )


@router.post("/login", response_model=StandardResponse)
async def login(
    login_data: LoginRequest,
    request: Request
):
    """
    Login user and get access/refresh tokens
    """
    try:
        user_agent = request.headers.get("user-agent")
        ip_address = request.client.host if request.client else None
        
        token, error = await auth_service.login(login_data, user_agent, ip_address)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Login successful",
            data={
                "token": token.dict() if token else None
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login failed: {str(e)}"
        )


@router.post("/refresh", response_model=StandardResponse)
async def refresh_token(
    token_data: RefreshTokenRequest
):
    """
    Refresh access token using refresh token
    """
    try:
        token, error = await auth_service.refresh_token(token_data.refresh_token)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Token refreshed",
            data={
                "token": token.dict() if token else None
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Token refresh failed: {str(e)}"
        )


@router.post("/logout", response_model=StandardResponse)
async def logout(
    token_data: RefreshTokenRequest,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Logout user (invalidate refresh token)
    """
    try:
        success = await auth_service.logout(token_data.refresh_token)
        
        if not success:
            return StandardResponse(
                success=False,
                message="Logout failed",
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Logged out successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Logout failed: {str(e)}"
        )


@router.post("/logout-all", response_model=StandardResponse)
async def logout_all(
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Logout user from all devices
    """
    try:
        success = await auth_service.logout_all(current_user.sub)
        
        if not success:
            return StandardResponse(
                success=False,
                message="Failed to logout from all devices",
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Logged out from all devices",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Logout failed: {str(e)}"
        )


@router.post("/verify-email", response_model=StandardResponse)
async def verify_email(
    verification_data: EmailVerificationRequest
):
    """
    Verify user email address
    """
    try:
        success, error = await auth_service.verify_email(verification_data.token)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Email verified successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Email verification failed: {str(e)}"
        )


@router.post("/resend-verification", response_model=StandardResponse)
async def resend_verification(
    email: str
):
    """
    Resend email verification
    """
    try:
        # TODO: Implement resend verification
        return StandardResponse(
            success=True,
            message="Verification email sent",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to resend verification: {str(e)}"
        )


@router.post("/forgot-password", response_model=StandardResponse)
async def forgot_password(
    password_reset: PasswordResetRequest
):
    """
    Request password reset
    """
    try:
        success, error = await auth_service.forgot_password(password_reset.email)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="If an account exists with this email, you will receive reset instructions",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Password reset request failed: {str(e)}"
        )


@router.post("/reset-password", response_model=StandardResponse)
async def reset_password(
    reset_data: PasswordResetConfirm
):
    """
    Reset password using token
    """
    try:
        success, error = await auth_service.reset_password(reset_data.token, reset_data.new_password)
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Password reset successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Password reset failed: {str(e)}"
        )


@router.post("/change-password", response_model=StandardResponse)
async def change_password(
    current_password: str,
    new_password: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Change password for authenticated user
    """
    try:
        success, error = await auth_service.change_password(
            current_user.sub,
            current_password,
            new_password
        )
        
        if error:
            return StandardResponse(
                success=False,
                message=error,
                data=None
            )
        
        return StandardResponse(
            success=True,
            message="Password changed successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Password change failed: {str(e)}"
        )


@router.get("/me", response_model=StandardResponse)
async def get_current_user_info(
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get current user information
    """
    try:
        # Get user details from database
        from core.database import database
        user = await database.get_user_by_id(current_user.sub)
        
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
            created_at=datetime.fromisoformat(user["created_at"])
        )
        
        return StandardResponse(
            success=True,
            message="User information retrieved",
            data={"user": user_public.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get user info: {str(e)}"
        )


@router.get("/check-email/{email}", response_model=StandardResponse)
async def check_email_availability(email: str):
    """
    Check if email is available for registration
    """
    try:
        from core.database import database
        user = await database.get_user_by_email(email)
        
        return StandardResponse(
            success=True,
            message="Email check completed",
            data={"available": user is None}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Email check failed: {str(e)}"
        )
